import { describe, expect, test, vi, type Mock } from 'vitest'
import {
  createClaudeLoginSession,
  LOGIN_LIMIT_MS,
  type ClaudeLoginDeps
} from '../../src/main/claude-login'
import type { AuthStatusResult } from '../../src/main/claude-auth'

const LOGGED_IN: AuthStatusResult = { kind: 'logged-in', info: { authMethod: 'claude.ai' } }

interface Harness {
  deps: ClaudeLoginDeps
  kill: Mock
  clearTimer: Mock
  sendEvent: Mock
  verify: Mock
  /** 자식 프로세스 종료를 대신 발생시킨다. */
  exitChild: () => void
  /** 시간 상한 타이머를 대신 발화시킨다. */
  fireTimer: () => void
}

// 자식 프로세스와 타이머를 손으로 돌린다 — 실제 프로세스·실시간 대기 없이 전 경로를 재현한다.
function harness(over: Partial<ClaudeLoginDeps> = {}): Harness {
  let exitChild: () => void = () => {}
  const kill = vi.fn()
  let fireTimer: () => void = () => {}
  const clearTimer = vi.fn()
  const sendEvent = vi.fn()
  const verify = vi.fn().mockResolvedValue(LOGGED_IN)

  const deps: ClaudeLoginDeps = {
    spawnLogin: (onExit) => {
      exitChild = onExit
      return { kill }
    },
    verify,
    sendEvent,
    setTimer: (_ms, fn) => {
      fireTimer = fn
      return clearTimer
    },
    ...over
  }
  return {
    deps,
    kill,
    clearTimer,
    sendEvent,
    verify,
    exitChild: () => exitChild(),
    fireTimer: () => fireTimer()
  }
}

// 이벤트 발신이 자식 종료 후 verify를 await하므로, 마이크로태스크를 비워야 관측된다.
const settle = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('createClaudeLoginSession', () => {
  test('자식이 끝나고 로그인이 확인되면 success를 보낸다', async () => {
    const h = harness()
    createClaudeLoginSession().start(h.deps)

    h.exitChild()
    await settle()

    expect(h.sendEvent).toHaveBeenCalledWith({ status: 'success' })
  })

  // exit code를 신뢰하지 않는다 — 사용자가 브라우저 탭을 닫아도 CLI는 깔끔히 끝날 수 있다.
  // 사실은 auth status만이 말한다.
  test('자식이 끝났는데 여전히 미로그인이면 incomplete를 보낸다', async () => {
    const h = harness({ verify: vi.fn().mockResolvedValue({ kind: 'logged-out' }) })
    createClaudeLoginSession().start(h.deps)

    h.exitChild()
    await settle()

    expect(h.sendEvent).toHaveBeenCalledWith({ status: 'incomplete' })
  })

  test('spawn이 실패하면 error를 보낸다', async () => {
    const h = harness({
      spawnLogin: () => {
        throw new Error('spawn 실패')
      }
    })
    createClaudeLoginSession().start(h.deps)
    await settle()

    expect(h.sendEvent).toHaveBeenCalledWith({ status: 'error', message: 'spawn 실패' })
  })

  test('verify가 던지면 error를 보낸다', async () => {
    const h = harness({ verify: vi.fn().mockRejectedValue(new Error('확인 실패')) })
    createClaudeLoginSession().start(h.deps)

    h.exitChild()
    await settle()

    expect(h.sendEvent).toHaveBeenCalledWith({ status: 'error', message: '확인 실패' })
  })

  // 취소는 사용자 의사다. kill 직전에 자격증명이 저장됐더라도 다음 [다시 확인]에서 반영된다 —
  // 취소했는데 성공 이벤트가 날아오면 사용자가 지운 화면이 되살아난다.
  test('취소하면 자식을 죽이고 어떤 이벤트도 보내지 않는다', async () => {
    const h = harness()
    const session = createClaudeLoginSession()
    session.start(h.deps)

    session.cancel()
    h.exitChild()
    await settle()

    expect(h.kill).toHaveBeenCalledTimes(1)
    expect(h.sendEvent).not.toHaveBeenCalled()
    expect(h.verify).not.toHaveBeenCalled()
  })

  // 무효화된 세션의 자식 종료가 이벤트를 보내면 새 세션의 대기 화면이 옛 결과로 덮인다.
  test('새 start는 이전 세션을 무효화한다', async () => {
    const first = harness()
    const second = harness()
    const session = createClaudeLoginSession()

    session.start(first.deps)
    session.start(second.deps)

    first.exitChild()
    await settle()
    expect(first.sendEvent).not.toHaveBeenCalled()
    expect(first.kill).toHaveBeenCalledTimes(1)

    second.exitChild()
    await settle()
    expect(second.sendEvent).toHaveBeenCalledWith({ status: 'success' })
  })

  // 브라우저를 닫고 앱을 방치하면 자식이 좀비로 남는다.
  test('시간 상한을 넘기면 자식을 죽이고 재검증한다', async () => {
    const h = harness()
    createClaudeLoginSession().start(h.deps)

    h.fireTimer()
    await settle()

    expect(h.kill).toHaveBeenCalledTimes(1)
    // 상한 초과라도 그 사이 로그인이 끝났을 수 있다 — incomplete로 단정하지 않는다.
    expect(h.sendEvent).toHaveBeenCalledWith({ status: 'success' })
  })

  test('자식이 정상 종료하면 타이머를 해제한다', async () => {
    const h = harness()
    createClaudeLoginSession().start(h.deps)

    h.exitChild()
    await settle()

    expect(h.clearTimer).toHaveBeenCalledTimes(1)
  })

  // 상한 kill이 자식 종료를 유발하면 onExit이 또 불린다 — 이벤트가 두 번 나가면 안 된다.
  test('종료 처리는 세션당 한 번만 일어난다', async () => {
    const h = harness()
    createClaudeLoginSession().start(h.deps)

    h.exitChild()
    h.exitChild()
    await settle()

    expect(h.sendEvent).toHaveBeenCalledTimes(1)
    expect(h.verify).toHaveBeenCalledTimes(1)
  })

  test('상한은 10분이다', () => {
    expect(LOGIN_LIMIT_MS).toBe(600_000)
  })
})

// AuthStatusResult를 4분할한 이유가 여기서 무너지면 안 된다 — 판정 불가와 확정 미로그인은
// 사용자가 할 일이 서로 다르다. 셋을 incomplete로 합치면 원인이 화면에 남지 않아
// 사용자가 눌러도 아무 일도 안 나는 버튼을 무한히 누른다.
describe('verify 결과별 통지 — 판정 불가를 미완료로 뭉개지 않는다', () => {
  async function eventFor(auth: AuthStatusResult): Promise<unknown> {
    const h = harness({ verify: vi.fn().mockResolvedValue(auth) })
    createClaudeLoginSession().start(h.deps)
    h.exitChild()
    await settle()
    return h.sendEvent.mock.calls[0]?.[0]
  }

  test('logged-out은 미완료다 (사용자가 동의를 안 마친 정상 경로)', async () => {
    expect(await eventFor({ kind: 'logged-out' })).toEqual({ status: 'incomplete' })
  })

  // PATH 문제로 spawn ENOENT가 나면 여기로 온다. "다시 시도"는 해결책이 아니다.
  test('not-installed는 실행할 수 없다고 알린다', async () => {
    const event = await eventFor({ kind: 'not-installed' })
    expect(event).toMatchObject({ status: 'error' })
    expect((event as { message: string }).message).toContain('실행할 수 없습니다')
  })

  // 구버전 CLI는 auth login도 auth status도 모른다. "다시 시도"로는 영구히 벗어나지 못한다.
  test('unsupported는 확인하지 못했다고 알린다', async () => {
    const event = await eventFor({ kind: 'unsupported' })
    expect(event).toMatchObject({ status: 'error' })
    expect((event as { message: string }).message).toContain('확인하지 못했습니다')
  })

  // 앱이 죽인 것을 사용자 미완료로 말하면, 브라우저에서 성공 화면을 본 사용자에게 앱이 거짓말을 한다.
  test('상한으로 끊긴 경우 그 사실을 알린다', async () => {
    const h = harness({ verify: vi.fn().mockResolvedValue({ kind: 'logged-out' }) })
    createClaudeLoginSession().start(h.deps)
    h.fireTimer()
    await settle()

    const event = h.sendEvent.mock.calls[0]?.[0] as { status: string; message?: string }
    expect(event.status).toBe('error')
    expect(event.message).toContain('제한 시간')
  })
})
