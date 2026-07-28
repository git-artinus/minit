import { describe, expect, test } from 'vitest'
import { releaseNotesUrl } from '../../src/shared/release'

describe('releaseNotesUrl', () => {
  // electron-updater가 주는 version은 접두사가 없지만 릴리즈 태그는 v0.9.0 형식이다.
  test('접두사 없는 버전에 v를 붙여 태그 URL을 만든다', () => {
    expect(releaseNotesUrl('0.9.0')).toBe(
      'https://github.com/git-artinus/minit/releases/tag/v0.9.0'
    )
  })

  test('이미 v가 붙어 있으면 중복해서 붙이지 않는다', () => {
    expect(releaseNotesUrl('v0.9.0')).toBe(
      'https://github.com/git-artinus/minit/releases/tag/v0.9.0'
    )
  })

  test('앞뒤 공백을 정리한다', () => {
    expect(releaseNotesUrl('  1.2.3  ')).toBe(
      'https://github.com/git-artinus/minit/releases/tag/v1.2.3'
    )
  })

  test('프리릴리즈 태그도 그대로 만든다', () => {
    expect(releaseNotesUrl('1.0.0-beta.1')).toBe(
      'https://github.com/git-artinus/minit/releases/tag/v1.0.0-beta.1'
    )
  })

  // 링크가 깨진 태그로 가느니 목록으로 보내는 편이 낫다.
  test('버전을 모르면 릴리즈 목록으로 보낸다', () => {
    const list = 'https://github.com/git-artinus/minit/releases'
    expect(releaseNotesUrl(undefined)).toBe(list)
    expect(releaseNotesUrl('')).toBe(list)
    expect(releaseNotesUrl('   ')).toBe(list)
  })
})

// version은 원격 피드(latest-mac.yml) 유래 문자열이다 — 검증 없이 경로에 보간하면 깨진 링크나
// 엉뚱한 경로로 이어진다. 형식이 어긋나면 404 태그가 아니라 목록으로 보낸다.
describe('releaseNotesUrl — 신뢰할 수 없는 입력', () => {
  const list = 'https://github.com/git-artinus/minit/releases'

  test('경로 조작 문자가 섞이면 목록으로 폴백한다', () => {
    expect(releaseNotesUrl('../../evil')).toBe(list)
    expect(releaseNotesUrl('1.0.0/../../other')).toBe(list)
  })

  test('버전 형식이 아니면 목록으로 폴백한다', () => {
    expect(releaseNotesUrl('latest')).toBe(list)
    expect(releaseNotesUrl('1.0')).toBe(list)
    expect(releaseNotesUrl('v 1.0.0')).toBe(list)
  })
})
