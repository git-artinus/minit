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

  // 링크가 깨진 태그로 가느니 목록으로 보내는 편이 낫다.
  test('버전을 모르면 릴리즈 목록으로 보낸다', () => {
    const list = 'https://github.com/git-artinus/minit/releases'
    expect(releaseNotesUrl(undefined)).toBe(list)
    expect(releaseNotesUrl('')).toBe(list)
    expect(releaseNotesUrl('   ')).toBe(list)
  })
})
