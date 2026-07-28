import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchLatestRelease } from '../src/lib/github'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fetchLatestRelease', () => {
  test('응답이 실패면 상태코드를 담아 throw한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' })
    )
    // 다운로드 링크 없는 랜딩페이지는 배포하면 안 되므로 폴백 없이 빌드를 실패시켜야 한다.
    await expect(fetchLatestRelease()).rejects.toThrow(/503/)
  })

  test('GITHUB_TOKEN이 있으면 Authorization 헤더를 붙인다', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', spy)
    vi.stubEnv('GITHUB_TOKEN', 'ghs_test')

    await fetchLatestRelease()

    const [, init] = spy.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer ghs_test')
  })

  test('GITHUB_TOKEN이 없으면 Authorization 헤더를 붙이지 않는다', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', spy)
    vi.stubEnv('GITHUB_TOKEN', '')

    await fetchLatestRelease()

    const [, init] = spy.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })
})
