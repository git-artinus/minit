import { describe, expect, test, vi } from 'vitest'
import { fetchWithTimeout } from '../../src/shared/fetch-timeout'

describe('fetchWithTimeout', () => {
  test('정상 응답이면 그대로 반환하고 타이머를 정리한다', async () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout')
    const response = { ok: true, status: 200 } as unknown as Response
    const fetchImpl = vi.fn(async () => response)

    const result = await fetchWithTimeout(fetchImpl, 'https://example.com', {}, 10_000)

    expect(result).toBe(response)
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  test('전달한 options에 signal을 추가해 fetchImpl을 호출한다', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response)

    await fetchWithTimeout(fetchImpl, 'https://example.com', { method: 'POST' }, 10_000)

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) })
    )
  })

  test('timeoutMs 경과 시 AbortController로 취소해 reject한다', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    ) as unknown as typeof fetch

    const promise = fetchWithTimeout(fetchImpl, 'https://example.com', {}, 10_000)
    const assertion = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    vi.useRealTimers()
  })

  test('timeoutMs를 생략하면 기본값 10초가 적용된다', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    ) as unknown as typeof fetch

    const promise = fetchWithTimeout(fetchImpl, 'https://example.com')
    const assertion = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    vi.useRealTimers()
  })
})
