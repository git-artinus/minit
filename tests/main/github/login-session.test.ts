import { describe, expect, test, vi } from 'vitest'
import { createLoginSessionManager } from '../../../src/main/github/login-session'
import type { PollResult } from '../../../src/main/github/device-flow'
import type { DeviceCodeInfo } from '../../../src/main/github/login-session'

function device(over: Partial<DeviceCodeInfo> = {}): DeviceCodeInfo {
  return { device_code: 'dev-code', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, ...over }
}

describe('createLoginSessionManager', () => {
  test('정상 경로: 성공 결과를 받으면 토큰 저장 후 성공 이벤트를 보낸다', async () => {
    const manager = createLoginSessionManager()
    const requestDeviceCode = vi.fn(async () => device())
    const pollForToken = vi.fn(async () => ({ status: 'success', accessToken: 'ghu_abc' }) as PollResult)
    const saveToken = vi.fn()
    const fetchViewer = vi.fn(async () => ({ login: 'joel' }))
    const sendEvent = vi.fn()

    const result = await manager.startLogin({ requestDeviceCode, pollForToken, saveToken, fetchViewer, sendEvent })

    expect(result).toEqual({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(saveToken).toHaveBeenCalledWith('ghu_abc')
    expect(sendEvent).toHaveBeenCalledWith({ status: 'success', login: 'joel' })
  })

  test('expired/denied/error 결과를 그대로 이벤트로 전달한다', async () => {
    const manager = createLoginSessionManager()
    const sendEvent = vi.fn()
    await manager.startLogin({
      requestDeviceCode: async () => device(),
      pollForToken: async () => ({ status: 'expired' }),
      saveToken: vi.fn(),
      fetchViewer: vi.fn(),
      sendEvent
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(sendEvent).toHaveBeenCalledWith({ status: 'expired' })
  })

  test('pollForToken이 reject하면 error 이벤트로 전달한다', async () => {
    const manager = createLoginSessionManager()
    const sendEvent = vi.fn()
    await manager.startLogin({
      requestDeviceCode: async () => device(),
      pollForToken: async () => {
        throw new Error('네트워크 오류')
      },
      saveToken: vi.fn(),
      fetchViewer: vi.fn(),
      sendEvent
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(sendEvent).toHaveBeenCalledWith({ status: 'error', message: '네트워크 오류' })
  })

  test('cancel() 호출 후 폴링이 성공으로 resolve돼도 토큰 저장·이벤트 미발생', async () => {
    const manager = createLoginSessionManager()
    let resolvePoll: ((r: PollResult) => void) | undefined
    const pollForToken = vi.fn(() => new Promise<PollResult>((resolve) => { resolvePoll = resolve }))
    const saveToken = vi.fn()
    const sendEvent = vi.fn()
    const fetchViewer = vi.fn(async () => ({ login: 'joel' }))

    await manager.startLogin({
      requestDeviceCode: async () => device(),
      pollForToken,
      saveToken,
      fetchViewer,
      sendEvent
    })

    manager.cancel()
    resolvePoll?.({ status: 'success', accessToken: 'ghu_stale' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(saveToken).not.toHaveBeenCalled()
    expect(sendEvent).not.toHaveBeenCalled()
  })

  test('cancel()은 진행 중인 폴링에 isCancelled=true를 전달해 루프 조기 종료를 유도한다', async () => {
    const manager = createLoginSessionManager()
    let capturedIsCancelled: (() => boolean) | undefined
    const pollForToken = vi.fn((_code: string, _interval: number, isCancelled: () => boolean) => {
      capturedIsCancelled = isCancelled
      return new Promise<PollResult>(() => {}) // 결정적 테스트를 위해 의도적으로 resolve하지 않는다.
    })

    await manager.startLogin({
      requestDeviceCode: async () => device(),
      pollForToken,
      saveToken: vi.fn(),
      fetchViewer: vi.fn(),
      sendEvent: vi.fn()
    })

    expect(capturedIsCancelled?.()).toBe(false)
    manager.cancel()
    expect(capturedIsCancelled?.()).toBe(true)
  })

  test('새 startLogin 호출은 이전 세션을 무효화한다 — 이전 세션 결과는 저장·발신되지 않는다', async () => {
    const manager = createLoginSessionManager()
    let resolveFirstPoll: ((r: PollResult) => void) | undefined
    const pollForTokenFirst = vi.fn(() => new Promise<PollResult>((resolve) => { resolveFirstPoll = resolve }))
    const saveToken1 = vi.fn()
    const sendEvent1 = vi.fn()

    await manager.startLogin({
      requestDeviceCode: async () => device({ device_code: 'd1' }),
      pollForToken: pollForTokenFirst,
      saveToken: saveToken1,
      fetchViewer: vi.fn(async () => ({ login: 'stale-user' })),
      sendEvent: sendEvent1
    })

    // 사용자가 재시도해 두 번째 로그인을 시작 — 첫 세션은 무효화된다.
    const saveToken2 = vi.fn()
    const sendEvent2 = vi.fn()
    await manager.startLogin({
      requestDeviceCode: async () => device({ device_code: 'd2' }),
      pollForToken: async () => ({ status: 'success', accessToken: 'ghu_new' }),
      saveToken: saveToken2,
      fetchViewer: vi.fn(async () => ({ login: 'joel' })),
      sendEvent: sendEvent2
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(saveToken2).toHaveBeenCalledWith('ghu_new')
    expect(sendEvent2).toHaveBeenCalledWith({ status: 'success', login: 'joel' })

    // 첫 세션의 폴링이 뒤늦게 success로 resolve돼도 이미 무효화되어 아무 효과가 없어야 한다.
    resolveFirstPoll?.({ status: 'success', accessToken: 'ghu_stale' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(saveToken1).not.toHaveBeenCalled()
    expect(sendEvent1).not.toHaveBeenCalled()
  })

  test('success 처리 도중(fetchViewer 대기 중) 세션이 무효화되면 이벤트를 보내지 않는다', async () => {
    const manager = createLoginSessionManager()
    let resolveViewer: ((v: { login: string }) => void) | undefined
    const saveToken = vi.fn()
    const sendEvent = vi.fn()

    await manager.startLogin({
      requestDeviceCode: async () => device(),
      pollForToken: async () => ({ status: 'success', accessToken: 'ghu_abc' }),
      saveToken,
      fetchViewer: () => new Promise((resolve) => { resolveViewer = resolve }),
      sendEvent
    })
    await Promise.resolve()
    await Promise.resolve()

    // saveToken은 fetchViewer 대기 이전에 이미 호출된다(성공 확정 시점).
    expect(saveToken).toHaveBeenCalledWith('ghu_abc')

    manager.cancel()
    resolveViewer?.({ login: 'joel' })
    await Promise.resolve()
    await Promise.resolve()

    expect(sendEvent).not.toHaveBeenCalled()
  })
})
