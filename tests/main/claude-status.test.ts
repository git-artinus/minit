import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  availabilityEvidence,
  createClaudeStatusChecker,
  PROBE_TIMEOUT_MS,
  probeClaude
} from '../../src/main/claude-status'
import { ClaudeRunError, type ClaudeRunFacts } from '../../src/main/pipeline/claude-run'
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

const installed = (): Promise<boolean> => Promise.resolve(true)

describe('probeClaude', () => {
  test('설치되어 있지 않으면 실행하지 않고 not_installed', async () => {
    const run = vi.fn()
    const status = await probeClaude({ commandExists: () => Promise.resolve(false), run })

    expect(status.ok).toBe(false)
    // 미설치 사용자에게 프로세스 생성을 시도할 이유가 없다 — 실행 자체가 일어나면 안 된다.
    expect(run).not.toHaveBeenCalled()
    expect(status.ok === false && status.failure.reason).toBe('not_installed')
  })

  test('정상 종료하면 ok', async () => {
    const status = await probeClaude({
      commandExists: installed,
      run: () => Promise.resolve({ stdout: 'ok' })
    })
    expect(status).toEqual({ ok: true })
  })

  // 프로브의 존재 이유. which로는 절대 알 수 없는 상태다.
  test('로그인이 안 되어 있으면 not_authenticated로 판정한다', async () => {
    const status = await probeClaude({
      commandExists: installed,
      run: () => Promise.reject(runError({ stdout: 'Not logged in · Please run /login' }))
    })
    expect(status.ok === false && status.failure.reason).toBe('not_authenticated')
  })

  test('사용량이 소진됐으면 usage_limit으로 판정한다', async () => {
    const status = await probeClaude({
      commandExists: installed,
      run: () => Promise.reject(runError({ stdout: 'Usage limit reached' }))
    })
    expect(status.ok === false && status.failure.reason).toBe('usage_limit')
  })

  // 온보딩에서 도는 검사라 요약(300초)과 같은 제한 시간을 쓰면 사용자는 앱이 멈춘 줄 안다.
  test('요약보다 짧은 제한 시간과 빈 stdin으로 실행한다', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'ok' })
    await probeClaude({ commandExists: installed, run })

    const [cmd, , stdin, timeoutMs] = run.mock.calls[0]
    expect(cmd).toBe('claude')
    expect(stdin).toBe('')
    expect(timeoutMs).toBe(PROBE_TIMEOUT_MS)
    expect(timeoutMs).toBeLessThan(300_000)
  })

  // OAuth를 무시하고 ANTHROPIC_API_KEY만 보므로, 붙이면 로그인 여부를 검사할 수 없게 된다.
  test('--bare를 쓰지 않는다', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'ok' })
    await probeClaude({ commandExists: installed, run })
    expect(run.mock.calls[0][1]).not.toContain('--bare')
  })
})

describe('availabilityEvidence', () => {
  const reasonOf = (reason: SummaryFailureReason): ClaudeStatus | null =>
    availabilityEvidence({ reason, detail: 'd' })

  test('성공은 사용 가능의 증거다', () => {
    expect(availabilityEvidence(null)).toEqual({ ok: true })
  })

  test('미설치·미로그인·사용량 소진은 사용 불가의 증거다', () => {
    for (const reason of ['not_installed', 'not_authenticated', 'usage_limit'] as const) {
      expect(reasonOf(reason)).toEqual({ ok: false, failure: { reason, detail: 'd' } })
    }
  })

  // claude가 응답까지 정상적으로 마쳤다는 뜻이다 — 형식이 어긋났을 뿐 CLI는 멀쩡하다.
  test('invalid_output은 오히려 사용 가능의 증거다', () => {
    expect(reasonOf('invalid_output')).toEqual({ ok: true })
  })

  // 긴 회의 한 번이 타임아웃했다고 설정 화면이 "사용 불가"로 바뀌면 안 된다.
  test('timeout·unknown은 아무 결론도 내지 않는다', () => {
    expect(reasonOf('timeout')).toBeNull()
    expect(reasonOf('unknown')).toBeNull()
  })
})

describe('createClaudeStatusChecker', () => {
  test('두 번째 호출은 프로브를 다시 돌리지 않는다', async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true })
    const checker = createClaudeStatusChecker(probe)

    await checker.get()
    await checker.get()

    expect(probe).toHaveBeenCalledTimes(1)
  })

  // 온보딩 패널과 설정 화면이 같이 열리면 실행이 두 번 돌아 사용량을 두 배로 쓴다.
  test('동시 호출은 하나의 프로브로 합친다', async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true })
    const checker = createClaudeStatusChecker(probe)

    const [a, b] = await Promise.all([checker.get(), checker.get()])

    expect(probe).toHaveBeenCalledTimes(1)
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
  })

  test('force면 캐시를 무시하고 다시 확인한다', async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, failure: { reason: 'not_authenticated', detail: 'd' } })
      .mockResolvedValueOnce({ ok: true })
    const checker = createClaudeStatusChecker(probe)

    await checker.get()
    // 사용자가 터미널에서 로그인한 뒤 [다시 확인]을 누르는 흐름. 캐시를 그대로 주면 영영 못 벗어난다.
    expect(await checker.get(true)).toEqual({ ok: true })
    expect(probe).toHaveBeenCalledTimes(2)
  })

  test('record한 판정은 프로브 없이 그대로 반환된다', async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true })
    const checker = createClaudeStatusChecker(probe)

    checker.record({ ok: false, failure: { reason: 'usage_limit', detail: 'd' } })

    expect(await checker.get()).toEqual({
      ok: false,
      failure: { reason: 'usage_limit', detail: 'd' }
    })
    expect(probe).not.toHaveBeenCalled()
  })

  // availabilityEvidence가 '결론 없음'으로 낸 null을 호출부가 그대로 넘길 수 있어야 한다.
  test('record(null)은 캐시를 건드리지 않는다', async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true })
    const checker = createClaudeStatusChecker(probe)

    await checker.get()
    checker.record(null)

    expect(await checker.get()).toEqual({ ok: true })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  // 실패를 캐시하면 일시적 IPC·spawn 오류 하나로 이 실행 내내 상태가 고장 난 채 남는다.
  test('프로브가 실패하면 캐시하지 않고 다음 호출에서 다시 시도한다', async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error('spawn 실패'))
      .mockResolvedValue({ ok: true })
    const checker = createClaudeStatusChecker(probe)

    await expect(checker.get()).rejects.toThrow('spawn 실패')
    expect(await checker.get()).toEqual({ ok: true })
    expect(probe).toHaveBeenCalledTimes(2)
  })
})
