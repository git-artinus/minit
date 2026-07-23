import { describe, expect, test, vi } from 'vitest'
import { GITHUB_CLIENT_ID, pollForToken, requestDeviceCode } from '../../../src/main/github/device-flow'

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe('requestDeviceCode', () => {
  test('client_id·scope=repo로 POST하고 응답을 그대로 반환한다', async () => {
    const body = {
      device_code: 'dev123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900
    }
    const fetchImpl = vi.fn(async () => jsonResponse(200, body))

    const result = await requestDeviceCode(fetchImpl as unknown as typeof fetch)

    expect(result).toEqual(body)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://github.com/login/device/code',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Accept: 'application/json' }),
        body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'repo' })
      })
    )
  })

  test('비2xx 응답이면 throw한다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}))
    await expect(requestDeviceCode(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/500/)
  })

  test('바디에 error 필드가 있으면 throw한다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { error: 'invalid_client' }))
    await expect(requestDeviceCode(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/invalid_client/)
  })

  test('타임아웃 시 reject한다', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    ) as unknown as typeof fetch

    const promise = requestDeviceCode(fetchImpl, GITHUB_CLIENT_ID, 10_000)
    const assertion = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    vi.useRealTimers()
  })
})

describe('pollForToken', () => {
  test('authorization_pending 후 성공하면 access_token을 반환한다', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'ghu_abc' }))
    const sleep = vi.fn(async () => undefined)

    const result = await pollForToken('dev123', 5, fetchImpl as unknown as typeof fetch, { sleep })

    expect(result).toEqual({ status: 'success', accessToken: 'ghu_abc' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(5000)
  })

  test('slow_down이면 interval을 5초 늘려 이후 대기에 반영한다', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { error: 'slow_down' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'ghu_abc' }))
    const sleep = vi.fn(async () => undefined)

    await pollForToken('dev123', 5, fetchImpl as unknown as typeof fetch, { sleep })

    expect(sleep).toHaveBeenNthCalledWith(1, 5000)
    expect(sleep).toHaveBeenNthCalledWith(2, 10000)
  })

  test('expired_token이면 즉시 중단하고 expired를 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, { error: 'expired_token' }))
    const sleep = vi.fn(async () => undefined)

    const result = await pollForToken('dev123', 5, fetchImpl as unknown as typeof fetch, { sleep })

    expect(result).toEqual({ status: 'expired' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('access_denied이면 즉시 중단하고 denied를 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, { error: 'access_denied' }))
    const sleep = vi.fn(async () => undefined)

    const result = await pollForToken('dev123', 5, fetchImpl as unknown as typeof fetch, { sleep })

    expect(result).toEqual({ status: 'denied' })
  })

  test('알 수 없는 오류면 error 상태로 메시지를 담아 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, { error: 'unexpected_thing' }))
    const sleep = vi.fn(async () => undefined)

    const result = await pollForToken('dev123', 5, fetchImpl as unknown as typeof fetch, { sleep })

    expect(result).toEqual({ status: 'error', message: 'unexpected_thing' })
  })

  test('매 폴링 전에 현재 interval만큼 sleep한다(폴링 로직은 sleep 주입으로 결정적)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse(200, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'ghu_final' }))
    const sleep = vi.fn(async (ms: number) => void ms)

    const result = await pollForToken('dev123', 3, fetchImpl as unknown as typeof fetch, { sleep })

    expect(result).toEqual({ status: 'success', accessToken: 'ghu_final' })
    expect(sleep).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.every((c) => c[0] === 3000)).toBe(true)
  })

  test('개별 폴 요청이 타임아웃되면 reject한다', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    ) as unknown as typeof fetch
    const sleep = vi.fn(async () => undefined)

    const promise = pollForToken('dev123', 5, fetchImpl, { sleep })
    const assertion = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    vi.useRealTimers()
  })

  test('isCancelled가 true를 반환하면(대기 전) fetch 없이 즉시 cancelled를 반환한다', async () => {
    const fetchImpl = vi.fn()
    const sleep = vi.fn(async () => undefined)
    const isCancelled = vi.fn(() => true)

    const result = await pollForToken('dev123', 5, fetchImpl as unknown as typeof fetch, { sleep, isCancelled })

    expect(result).toEqual({ status: 'cancelled' })
    expect(sleep).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('sleep 이후 isCancelled가 true가 되면 fetch 없이 cancelled를 반환한다', async () => {
    const fetchImpl = vi.fn()
    let cancelledAfterSleep = false
    const sleep = vi.fn(async () => {
      cancelledAfterSleep = true
    })
    const isCancelled = vi.fn(() => cancelledAfterSleep)

    const result = await pollForToken('dev123', 5, fetchImpl as unknown as typeof fetch, { sleep, isCancelled })

    expect(result).toEqual({ status: 'cancelled' })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('isCancelled가 false를 유지하면 기존과 동일하게 폴링을 계속한다', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'ghu_abc' }))
    const sleep = vi.fn(async () => undefined)
    const isCancelled = vi.fn(() => false)

    const result = await pollForToken('dev123', 5, fetchImpl as unknown as typeof fetch, { sleep, isCancelled })

    expect(result).toEqual({ status: 'success', accessToken: 'ghu_abc' })
  })
})
