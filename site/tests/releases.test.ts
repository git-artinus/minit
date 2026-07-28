import { describe, expect, test } from 'vitest'
import {
  findDmgAsset,
  selectPublished,
  toDownload,
  toReleaseEntries,
  type GitHubRelease
} from '../src/lib/releases'

const asset = (name: string, size = 1024 * 1024 * 118) => ({
  name,
  browser_download_url: `https://example.test/${name}`,
  size
})

// v0.8.0의 실제 에셋 구성 — 사용자가 받아야 할 것은 dmg 하나뿐이다.
const release = (over: Partial<GitHubRelease> = {}): GitHubRelease => ({
  tag_name: 'v0.8.0',
  body: '## 새 기능\n\n- 회의록 삭제',
  published_at: '2026-07-27T02:53:43Z',
  html_url: 'https://github.com/git-artinus/minit/releases/tag/v0.8.0',
  draft: false,
  prerelease: false,
  assets: [
    asset('latest-mac.yml', 512),
    asset('Minit-0.8.0-arm64-mac.zip'),
    asset('Minit-0.8.0-arm64-mac.zip.blockmap', 2048),
    asset('minit-0.8.0.dmg'),
    asset('minit-0.8.0.dmg.blockmap', 2048)
  ],
  ...over
})

describe('findDmgAsset', () => {
  test('에셋 5개에서 dmg 하나만 고른다', () => {
    expect(findDmgAsset(release()).name).toBe('minit-0.8.0.dmg')
  })

  test('dmg.blockmap을 dmg로 오인하지 않는다', () => {
    const only = release({ assets: [asset('minit-0.8.0.dmg.blockmap')] })
    expect(() => findDmgAsset(only)).toThrow(/dmg/i)
  })

  test('dmg가 없으면 개수를 담아 throw', () => {
    const none = release({ assets: [asset('latest-mac.yml')] })
    expect(() => findDmgAsset(none)).toThrow(/0개다/)
  })

  test('dmg가 둘 이상이면 throw', () => {
    const two = release({ assets: [asset('a.dmg'), asset('b.dmg')] })
    expect(() => findDmgAsset(two)).toThrow(/2개다/)
  })
})

describe('selectPublished', () => {
  test('draft와 prerelease를 걸러낸다', () => {
    const list = [
      release({ tag_name: 'v0.8.0' }),
      release({ tag_name: 'v0.9.0-rc1', prerelease: true }),
      release({ tag_name: 'v1.0.0', draft: true })
    ]
    expect(selectPublished(list).map((r) => r.tag_name)).toEqual(['v0.8.0'])
  })

  test('발행일 내림차순으로 정렬한다', () => {
    const list = [
      release({ tag_name: 'v0.6.0', published_at: '2026-07-24T02:46:44Z' }),
      release({ tag_name: 'v0.8.0', published_at: '2026-07-27T02:53:43Z' }),
      release({ tag_name: 'v0.7.0', published_at: '2026-07-26T23:02:47Z' })
    ]
    expect(selectPublished(list).map((r) => r.tag_name)).toEqual(['v0.8.0', 'v0.7.0', 'v0.6.0'])
  })
})

describe('toDownload', () => {
  test('태그의 v를 떼고 용량을 MB 정수로 환산한다', () => {
    expect(toDownload(release())).toEqual({
      version: '0.8.0',
      url: 'https://example.test/minit-0.8.0.dmg',
      sizeMB: 118
    })
  })
})

describe('toReleaseEntries', () => {
  test('발행일을 YYYY-MM-DD로 자르고 dmg 링크를 붙인다', () => {
    const [entry] = toReleaseEntries([release()])
    expect(entry.publishedAt).toBe('2026-07-27')
    expect(entry.version).toBe('0.8.0')
    expect(entry.dmgUrl).toBe('https://example.test/minit-0.8.0.dmg')
    expect(entry.bodyMarkdown).toContain('회의록 삭제')
  })

  test('dmg가 없는 과거 릴리즈는 dmgUrl을 null로 두고 건너뛰지 않는다', () => {
    const old = release({ tag_name: 'v0.1.0', assets: [asset('latest-mac.yml')] })
    const [entry] = toReleaseEntries([old])
    expect(entry.dmgUrl).toBeNull()
    expect(entry.version).toBe('0.1.0')
  })

  test('body가 null이면 빈 문자열로 정규화한다', () => {
    const [entry] = toReleaseEntries([release({ body: null })])
    expect(entry.bodyMarkdown).toBe('')
  })

  // toReleaseEntries가 selectPublished를 거치지 않게 바뀌면 draft·prerelease가 공개
  // Changelog로 새어 나간다. 단일 원소 배열만 넘기는 위 테스트들로는 잡히지 않는다.
  test('draft·prerelease를 걸러내고 발행일 내림차순으로 정렬한다', () => {
    const list = [
      release({ tag_name: 'v0.6.0', published_at: '2026-07-24T02:46:44Z' }),
      release({ tag_name: 'v0.9.0-rc1', prerelease: true }),
      release({ tag_name: 'v0.8.0', published_at: '2026-07-27T02:53:43Z' }),
      release({ tag_name: 'v1.0.0', draft: true })
    ]
    expect(toReleaseEntries(list).map((e) => e.version)).toEqual(['0.8.0', '0.6.0'])
  })
})
