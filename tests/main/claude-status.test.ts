import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  availabilityEvidence,
  createClaudeStatusChecker,
  PROBE_PROMPT,
  PROBE_TIMEOUT_MS,
  probeClaude
} from '../../src/main/claude-status'
import {
  ClaudeRunError,
  SUMMARY_TIMEOUT_MS,
  type ClaudeRunFacts
} from '../../src/main/pipeline/claude-run'
import {
  AUTH_STATUS_ARGS,
  AUTH_STATUS_TIMEOUT_MS,
  type AuthStatusResult
} from '../../src/main/claude-auth'
import type { ClaudeStatus, SummaryFailureReason } from '../../src/shared/types'

// probeClaude는 실패 시 진단 전문을 console.error로 남긴다(분류기 경유). 출력만 죽인다.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function runError(over: Partial<ClaudeRunFacts> = {}): ClaudeRunError {
  return new ClaudeRunError({
    stdout: '',
    stderr: '',
    exitCode: 1,
    errorCode: null,
    killed: false,
    signal: null,
    timeoutMs: PROBE_TIMEOUT_MS,
    stdinFailed: false,
    ...over
  })
}

function timedOut(): ClaudeRunError {
  return runError({ exitCode: null, killed: true, signal: 'SIGTERM' })
}

const installed = (): Promise<boolean> => Promise.resolve(true)

const authResult = (r: AuthStatusResult) => () => Promise.resolve(r)
// auth status가 판정에 개입하지 않는 경로. "프로브가 무엇을 판정하는가"를 고정하는 테스트는
// 이걸 써야 원래 의도가 그대로 남는다(auth status가 먼저 답하면 프로브는 아예 돌지 않는다).
const authSkipped = authResult({ kind: 'unsupported' })
const authLoggedIn = authResult({ kind: 'logged-in', info: { authMethod: 'claude.ai' } })

describe('probeClaude', () => {
  test('설치되어 있지 않으면 실행하지 않고 not_installed', async () => {
    const run = vi.fn()
    const status = await probeClaude({ commandExists: () => Promise.resolve(false), run })

    // 미설치 사용자에게 프로세스 생성을 시도할 이유가 없다 — 실행 자체가 일어나면 안 된다.
    expect(run).not.toHaveBeenCalled()
    expect(status).toEqual({
      kind: 'unavailable',
      failure: { reason: 'not_installed', detail: expect.any(String) }
    })
  })

  test('정상 종료하면 available', async () => {
    const status = await probeClaude({
      commandExists: installed,
      run: () => Promise.resolve({ stdout: 'ok' }),
      checkAuth: authSkipped
    })
    expect(status).toEqual({ kind: 'available' })
  })

  // 프로브의 존재 이유. which로는 절대 알 수 없는 상태다.
  test('로그인이 안 되어 있으면 unavailable + not_authenticated', async () => {
    const status = await probeClaude({
      commandExists: installed,
      run: () => Promise.reject(runError({ stdout: 'Not logged in · Please run /login' })),
      checkAuth: authSkipped
    })
    expect(status.kind).toBe('unavailable')
    expect(status.kind !== 'available' && status.failure.reason).toBe('not_authenticated')
  })

  test('사용량이 소진됐으면 unavailable + usage_limit', async () => {
    const status = await probeClaude({
      commandExists: installed,
      run: () => Promise.reject(runError({ stdout: 'Usage limit reached' })),
      checkAuth: authSkipped
    })
    expect(status.kind).toBe('unavailable')
    expect(status.kind !== 'available' && status.failure.reason).toBe('usage_limit')
  })

  // 콜드 스타트가 느려 한 번 타임아웃한 것을 "못 쓴다"로 확정하면 세션 내내 거짓 경고가 붙는다.
  // 요약 실패에 적용하는 기준(availabilityEvidence)을 프로브 자신에게도 똑같이 적용해야 한다.
  test('타임아웃은 확정 판정이 아니라 undetermined다', async () => {
    const status = await probeClaude({
      commandExists: installed,
      run: () => Promise.reject(timedOut()),
      checkAuth: authSkipped
    })
    expect(status.kind).toBe('undetermined')
  })

  // -p가 빠지면 비대화형 1회 실행이 아니게 되고, 프롬프트가 빠지면 빈 요청이 된다. 둘 다
  // 전원이 매 실행마다 60초를 버리고 "확인 실패"를 보는 결과가 된다.
  test('claude를 -p + 프로브 프롬프트로, 빈 stdin에 짧은 제한 시간으로 실행한다', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'ok' })
    await probeClaude({ commandExists: installed, run, checkAuth: authSkipped })

    // --bare는 OAuth를 무시하고 ANTHROPIC_API_KEY만 보므로 붙이면 로그인 여부를 검사할 수 없다.
    // toEqual이라 그 플래그를 포함한 어떤 인자 변경도 여기서 걸린다.
    expect(run).toHaveBeenCalledWith('claude', ['-p', PROBE_PROMPT], '', PROBE_TIMEOUT_MS)
    expect(PROBE_TIMEOUT_MS).toBeLessThan(SUMMARY_TIMEOUT_MS)
  })

  // 이 재구성의 핵심. 미로그인 사용자에게 사용량 소모를 시도하지 않는다 —
  // auth status가 이미 확정 판정을 줬으므로 프로브는 아무것도 더 알려주지 못한다.
  test('미로그인이면 프로브를 돌리지 않고 not_authenticated', async () => {
    const run = vi.fn()
    const status = await probeClaude({
      commandExists: installed,
      run,
      checkAuth: authResult({ kind: 'logged-out' })
    })

    expect(run).not.toHaveBeenCalled()
    expect(status).toEqual({
      kind: 'unavailable',
      failure: { reason: 'not_authenticated', detail: expect.any(String) }
    })
  })

  // which는 통과했는데 auth status가 ENOENT면 그 사이 삭제된 것이다. 프로브는 무의미하다.
  test('auth status가 미설치를 보고하면 프로브를 돌리지 않는다', async () => {
    const run = vi.fn()
    const status = await probeClaude({
      commandExists: installed,
      run,
      checkAuth: authResult({ kind: 'not-installed' })
    })

    expect(run).not.toHaveBeenCalled()
    expect(status).toEqual({
      kind: 'unavailable',
      failure: { reason: 'not_installed', detail: expect.any(String) }
    })
  })

  // auth status는 사용량을 모른다. 로그인됨을 확인한 뒤에도 프로브를 돌려야
  // usage_limit을 요약 실행 전에 알 수 있다(#8의 존재 이유).
  test('로그인됐으면 프로브를 돌려 사용량까지 확인한다', async () => {
    const run = vi.fn().mockRejectedValue(runError({ stdout: 'Usage limit reached' }))
    const status = await probeClaude({ commandExists: installed, run, checkAuth: authLoggedIn })

    expect(run).toHaveBeenCalledWith('claude', ['-p', PROBE_PROMPT], '', PROBE_TIMEOUT_MS)
    expect(status.kind).toBe('unavailable')
    expect(status.kind !== 'available' && status.failure.reason).toBe('usage_limit')
  })

  test('로그인됐고 프로브가 정상 종료하면 available', async () => {
    const status = await probeClaude({
      commandExists: installed,
      run: () => Promise.resolve({ stdout: 'ok' }),
      checkAuth: authLoggedIn
    })
    expect(status).toEqual({ kind: 'available' })
  })

  // 구버전 CLI 하위호환. auth status를 못 쓰면 기존 경로 그대로 — 프로브의 키워드 분류가
  // 로그인 여부를 잡아낸다. 여기서 프로브를 건너뛰면 구버전 사용자는 판정을 아예 못 받는다.
  test('auth status를 못 쓰면 프로브로 폴백한다', async () => {
    const run = vi.fn().mockRejectedValue(runError({ stdout: 'Not logged in · Please run /login' }))
    const status = await probeClaude({ commandExists: installed, run, checkAuth: authSkipped })

    expect(run).toHaveBeenCalledTimes(1)
    expect(status.kind).toBe('unavailable')
    expect(status.kind !== 'available' && status.failure.reason).toBe('not_authenticated')
  })
})

describe('availabilityEvidence', () => {
  const of = (reason: SummaryFailureReason): ClaudeStatus =>
    availabilityEvidence({ reason, detail: 'd' })

  test('미설치·미로그인·사용량 소진은 확정적으로 사용 불가다', () => {
    for (const reason of ['not_installed', 'not_authenticated', 'usage_limit'] as const) {
      expect(of(reason)).toEqual({ kind: 'unavailable', failure: { reason, detail: 'd' } })
    }
  })

  // claude가 응답까지 정상적으로 마쳤다는 뜻이다 — 형식이 어긋났을 뿐 CLI는 멀쩡하다.
  test('invalid_output은 오히려 사용 가능의 증거다', () => {
    expect(of('invalid_output')).toEqual({ kind: 'available' })
  })

  // 긴 회의 한 번이 타임아웃했다고 설정 화면이 "사용 불가"로 바뀌면 안 된다.
  test('timeout·unknown은 결론을 내지 않는다', () => {
    expect(of('timeout').kind).toBe('undetermined')
    expect(of('unknown').kind).toBe('undetermined')
  })
})

describe('createClaudeStatusChecker', () => {
  const available: ClaudeStatus = { kind: 'available' }
  const unavailable = (reason: SummaryFailureReason): ClaudeStatus => ({
    kind: 'unavailable',
    failure: { reason, detail: 'd' }
  })

  test('두 번째 호출은 프로브를 다시 돌리지 않는다', async () => {
    const probe = vi.fn().mockResolvedValue(available)
    const checker = createClaudeStatusChecker(probe)

    await checker.get()
    await checker.get()

    expect(probe).toHaveBeenCalledTimes(1)
  })

  // StrictMode의 이중 마운트나 조회자가 늘면 프로브가 두 번 돌아 사용량을 두 배로 쓴다.
  test('동시 호출은 하나의 프로브로 합친다', async () => {
    const probe = vi.fn().mockResolvedValue(available)
    const checker = createClaudeStatusChecker(probe)

    const [a, b] = await Promise.all([checker.get(), checker.get()])

    expect(probe).toHaveBeenCalledTimes(1)
    expect(a).toEqual(available)
    expect(b).toEqual(available)
  })

  test('force면 캐시를 무시하고 다시 확인한다', async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce(unavailable('not_authenticated'))
      .mockResolvedValueOnce(available)
    const checker = createClaudeStatusChecker(probe)

    await checker.get()
    // 사용자가 터미널에서 로그인한 뒤 [다시 확인]을 누르는 흐름. 캐시를 그대로 주면 영영 못 벗어난다.
    expect(await checker.get(true)).toEqual(available)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  // force는 합치지 않는다(캐시 무시가 곧 목적이다). 렌더러가 버튼을 잠가 실사용에서 겹치지
  // 않지만, 그 방어가 사라지면 여기서 사용량이 배로 나간다는 사실을 고정해 둔다.
  test('force끼리는 합치지 않는다', async () => {
    const probe = vi.fn().mockResolvedValue(available)
    const checker = createClaudeStatusChecker(probe)

    await Promise.all([checker.get(true), checker.get(true)])

    expect(probe).toHaveBeenCalledTimes(2)
  })

  test('record한 판정은 프로브 없이 그대로 반환된다', async () => {
    const probe = vi.fn().mockResolvedValue(available)
    const checker = createClaudeStatusChecker(probe)

    checker.record(unavailable('usage_limit'))

    expect(await checker.get()).toEqual(unavailable('usage_limit'))
    expect(probe).not.toHaveBeenCalled()
  })

  // undetermined는 결론이 아니다. 캐시를 덮으면 이미 아는 사실이 "모름"으로 후퇴한다.
  test('undetermined record는 캐시를 건드리지 않는다', async () => {
    const probe = vi.fn().mockResolvedValue(available)
    const checker = createClaudeStatusChecker(probe)

    await checker.get()
    checker.record({ kind: 'undetermined', failure: { reason: 'timeout', detail: 'd' } })

    expect(await checker.get()).toEqual(available)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  // 프로브가 도는 사이 실제 요약이 실패하면 그쪽이 더 새로운 사실이다. 프로브는 한도에 걸리기
  // 전에 나간 요청일 수 있어, 덮으면 방금 실패한 CLI를 "사용 가능"이라고 말하게 된다.
  test('진행 중인 프로브가 그 사이 record된 판정을 덮지 않는다', async () => {
    let resolveProbe: (s: ClaudeStatus) => void = () => {}
    const probe = vi.fn().mockReturnValue(
      new Promise<ClaudeStatus>((r) => {
        resolveProbe = r
      })
    )
    const checker = createClaudeStatusChecker(probe)

    const pending = checker.get()
    checker.record(unavailable('usage_limit'))
    resolveProbe(available)

    expect(await pending).toEqual(unavailable('usage_limit'))
    expect(await checker.get()).toEqual(unavailable('usage_limit'))
  })

  // 결론을 못 낸 판정을 캐시하면 다음 조회가 영영 프로브를 돌리지 않아 상태가 고착된다.
  test('undetermined 프로브 결과는 캐시하지 않고 다음 조회에서 재시도한다', async () => {
    const undetermined: ClaudeStatus = {
      kind: 'undetermined',
      failure: { reason: 'timeout', detail: 'd' }
    }
    const probe = vi.fn().mockResolvedValueOnce(undetermined).mockResolvedValueOnce(available)
    const checker = createClaudeStatusChecker(probe)

    // 호출자에게는 사실대로 돌려줘야 설정 화면이 "확인 실패"를 표시할 수 있다.
    expect(await checker.get()).toEqual(undetermined)
    expect(await checker.get()).toEqual(available)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  // 실패를 캐시하면 일시적 spawn 오류 하나로 이 실행 내내 상태가 고장 난 채 남는다.
  test('프로브가 실패하면 캐시하지 않고 다음 호출에서 다시 시도한다', async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error('spawn 실패'))
      .mockResolvedValue(available)
    const checker = createClaudeStatusChecker(probe)

    await expect(checker.get()).rejects.toThrow('spawn 실패')
    expect(await checker.get()).toEqual(available)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  describe('onChanged — 요약 실행이 알아낸 사실을 렌더러로 밀어준다', () => {
    test('record가 판정을 바꾸면 통지한다', async () => {
      const onChanged = vi.fn()
      const checker = createClaudeStatusChecker(vi.fn().mockResolvedValue(available), onChanged)

      await checker.get()
      checker.record(unavailable('not_authenticated'))

      expect(onChanged).toHaveBeenCalledWith(unavailable('not_authenticated'))
    })

    // 회의마다 같은 값이 다시 통지되면 화면만 헛돈다.
    test('같은 판정이 반복되면 통지하지 않는다', async () => {
      const onChanged = vi.fn()
      const checker = createClaudeStatusChecker(vi.fn().mockResolvedValue(available), onChanged)

      await checker.get()
      checker.record(available)

      expect(onChanged).not.toHaveBeenCalled()
    })

    test('undetermined는 통지하지 않는다', () => {
      const onChanged = vi.fn()
      const checker = createClaudeStatusChecker(vi.fn(), onChanged)

      checker.record({ kind: 'undetermined', failure: { reason: 'timeout', detail: 'd' } })

      expect(onChanged).not.toHaveBeenCalled()
    })
  })
})

// 프로덕션이 실제로 타는 경로. 위 테스트들은 전부 checkAuth를 주입하므로 기본 배선
// (`deps.checkAuth ?? checkAuthStatus`)을 아무도 밟지 않는다 — 배선이 깨지면
// claude:status invoke가 전 사용자에게서 실패하는데 테스트는 통과한다.
describe('probeClaude 기본 배선 — checkAuth를 주입하지 않은 경우', () => {
  test('auth status를 먼저 실행하고 그다음 프로브를 실행한다', async () => {
    const calls: { args: string[]; timeout: number | undefined }[] = []
    const run = vi.fn(async (_cmd: string, args: string[], _stdin: string, timeout?: number) => {
      calls.push({ args, timeout })
      // 1차(auth status)는 로그인됨을 알리고, 2차(프로브)는 정상 종료한다.
      return { stdout: args[0] === 'auth' ? JSON.stringify({ loggedIn: true }) : 'ok' }
    })

    const status = await probeClaude({ commandExists: installed, run })

    expect(status).toEqual({ kind: 'available' })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({ args: [...AUTH_STATUS_ARGS], timeout: AUTH_STATUS_TIMEOUT_MS })
    expect(calls[1]).toEqual({ args: ['-p', PROBE_PROMPT], timeout: PROBE_TIMEOUT_MS })
  })

  test('기본 배선에서 미로그인이면 프로브를 돌리지 않는다', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ loggedIn: false }) })

    const status = await probeClaude({ commandExists: installed, run })

    expect(run).toHaveBeenCalledTimes(1)
    expect(status).toEqual({
      kind: 'unavailable',
      failure: { reason: 'not_authenticated', detail: expect.any(String) }
    })
  })
})
