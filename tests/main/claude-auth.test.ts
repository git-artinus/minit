import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AUTH_STATUS_ARGS,
  AUTH_STATUS_TIMEOUT_MS,
  checkAuthStatus,
  parseAuthStatus
} from '../../src/main/claude-auth'
import { ClaudeRunError, type ClaudeRunFacts } from '../../src/main/pipeline/claude-run'

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
    timeoutMs: AUTH_STATUS_TIMEOUT_MS,
    stdinFailed: false,
    ...over
  })
}

const LOGGED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'user@example.com',
  orgName: 'Example Org',
  subscriptionType: 'team'
})
const LOGGED_OUT = JSON.stringify({
  loggedIn: false,
  authMethod: 'none',
  apiProvider: 'firstParty'
})

describe('parseAuthStatus', () => {
  test('로그인 상태와 계정 정보를 읽는다', () => {
    expect(parseAuthStatus(LOGGED_IN)).toEqual({
      kind: 'logged-in',
      info: {
        authMethod: 'claude.ai',
        email: 'user@example.com',
        orgName: 'Example Org',
        subscriptionType: 'team'
      }
    })
  })

  test('미로그인을 읽는다', () => {
    expect(parseAuthStatus(LOGGED_OUT)).toEqual({ kind: 'logged-out' })
  })

  // 자동 업데이트 배너 등 비-JSON 전문이 앞에 붙을 수 있다. 여기서 null로 떨어지면
  // 호출자가 unsupported로 승격해 폴백 경로로 흘러가 사용량을 태운다.
  test('JSON 앞에 잡음이 붙어도 읽는다', () => {
    expect(parseAuthStatus(`Claude Code is updating…\n${LOGGED_IN}`)).toEqual({
      kind: 'logged-in',
      info: expect.objectContaining({ authMethod: 'claude.ai' })
    })
  })

  // 미지원 서브커맨드는 stdout이 비고 에러가 stderr로 간다(실측). 이걸 미로그인으로 읽으면
  // 구버전 CLI 사용자 전원이 있지도 않은 로그인 버튼을 보게 된다.
  test('빈 출력은 판정 불가다', () => {
    expect(parseAuthStatus('')).toBeNull()
    expect(parseAuthStatus('   \n ')).toBeNull()
  })

  test('JSON이 아니면 판정 불가다', () => {
    expect(parseAuthStatus('error: unknown command')).toBeNull()
  })

  // loggedIn이 곧 판정 전부다. 없거나 타입이 다르면 추측하지 않는다.
  test('loggedIn이 boolean이 아니면 판정 불가다', () => {
    expect(parseAuthStatus(JSON.stringify({ authMethod: 'claude.ai' }))).toBeNull()
    expect(parseAuthStatus(JSON.stringify({ loggedIn: 'yes' }))).toBeNull()
  })

  // authMethod가 없어도 loggedIn:true면 로그인은 사실이다 — 부가 정보 부재로 판정을 버리지 않는다.
  test('부가 정보가 없어도 로그인 판정은 유지한다', () => {
    expect(parseAuthStatus(JSON.stringify({ loggedIn: true }))).toEqual({
      kind: 'logged-in',
      info: { authMethod: 'unknown' }
    })
  })
})

describe('checkAuthStatus', () => {
  test('auth status --json을 빈 stdin에 짧은 제한 시간으로 실행한다', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: LOGGED_IN })
    await checkAuthStatus({ run })
    expect(run).toHaveBeenCalledWith('claude', [...AUTH_STATUS_ARGS], '', AUTH_STATUS_TIMEOUT_MS)
  })

  // 미로그인은 exit 1이라 ClaudeRunError로 도착한다. 이걸 실패로 처리하면 이 모듈의 존재 이유가 사라진다.
  test('미로그인은 exit 1로 오지만 stdout의 JSON으로 판정한다', async () => {
    const result = await checkAuthStatus({
      run: () => Promise.reject(runError({ stdout: LOGGED_OUT }))
    })
    expect(result).toEqual({ kind: 'logged-out' })
  })

  test('ENOENT는 not-installed다', async () => {
    const result = await checkAuthStatus({
      run: () => Promise.reject(runError({ errorCode: 'ENOENT' }))
    })
    expect(result).toEqual({ kind: 'not-installed' })
  })

  // 구버전 CLI. 프로브 폴백으로 흘려보내야 기존 키워드 분류가 로그인 여부를 잡아낸다.
  test('stdout에 JSON이 없으면 unsupported다', async () => {
    const result = await checkAuthStatus({
      run: () => Promise.reject(runError({ stderr: "error: unknown command 'auth'" }))
    })
    expect(result).toEqual({ kind: 'unsupported' })
  })

  test('타임아웃도 unsupported로 흘려보낸다', async () => {
    const result = await checkAuthStatus({
      run: () => Promise.reject(runError({ exitCode: null, killed: true, signal: 'SIGTERM' }))
    })
    expect(result).toEqual({ kind: 'unsupported' })
  })

  // ClaudeRunError가 아닌 예외(주입 실수·프로그래밍 오류)도 판정을 막지 않는다.
  test('예상 밖 예외도 unsupported로 흡수한다', async () => {
    const result = await checkAuthStatus({ run: () => Promise.reject(new Error('boom')) })
    expect(result).toEqual({ kind: 'unsupported' })
  })

  test('exit 0인데 출력이 비면 unsupported다', async () => {
    const result = await checkAuthStatus({ run: () => Promise.resolve({ stdout: '' }) })
    expect(result).toEqual({ kind: 'unsupported' })
  })
})

// unsupported는 "사용량을 쓰는 프로브로 폴백한다"는 뜻이다. 기록이 없으면 현장에서 이 폴백이
// 상시 터지고 있어도 아무도 모르고, 이 모듈의 목적이 조용히 무력화된다.
describe('판정 불가 사유 기록', () => {
  test('실행이 실패하면 진단 정보를 남긴다', async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    spy.mockClear() // 파일 상단 beforeEach의 스파이가 이전 테스트 호출을 들고 있다

    await checkAuthStatus({
      run: () => Promise.reject(runError({ stderr: 'keychain access denied', exitCode: 1 }))
    })

    expect(spy).toHaveBeenCalledWith('[claude] auth status 판정 불가', expect.any(Object))
    // 사용자가 고칠 수 있는 유일한 단서가 원문이다 — 이걸 빼면 폐기하는 것과 같다.
    expect(JSON.stringify(spy.mock.calls[0]?.[1])).toContain('keychain access denied')
  })

  test('정상 종료했지만 읽을 수 없는 출력도 남긴다', async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    spy.mockClear() // 파일 상단 beforeEach의 스파이가 이전 테스트 호출을 들고 있다

    await checkAuthStatus({ run: () => Promise.resolve({ stdout: '알 수 없는 형식' }) })

    expect(spy).toHaveBeenCalledWith('[claude] auth status 판정 불가', expect.any(Object))
  })

  // 미설치·미로그인은 확정 판정이다 — 폴백이 아니므로 오류로 남기면 로그가 소음이 된다.
  test('확정 판정에는 남기지 않는다', async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    spy.mockClear() // 파일 상단 beforeEach의 스파이가 이전 테스트 호출을 들고 있다

    await checkAuthStatus({ run: () => Promise.resolve({ stdout: LOGGED_OUT }) })
    await checkAuthStatus({ run: () => Promise.reject(runError({ errorCode: 'ENOENT' })) })

    expect(spy).not.toHaveBeenCalled()
  })
})
