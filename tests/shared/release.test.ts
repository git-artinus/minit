import { describe, expect, test } from 'vitest'
import { changelogUrl, releasesPageUrl } from '../../src/shared/release'

const CHANGELOG = 'https://git-artinus.github.io/minit/changelog/'
const RELEASES = 'https://github.com/git-artinus/minit/releases'

describe('changelogUrl', () => {
  // electron-updater가 주는 version은 접두사가 없지만 페이지 앵커는 v0.9.0 형식이다.
  test('접두사 없는 버전에 v를 붙여 앵커를 만든다', () => {
    expect(changelogUrl('0.9.0')).toBe(`${CHANGELOG}#v0.9.0`)
  })

  test('이미 v가 붙어 있으면 중복해서 붙이지 않는다', () => {
    expect(changelogUrl('v0.9.0')).toBe(`${CHANGELOG}#v0.9.0`)
  })

  test('앞뒤 공백을 정리한다', () => {
    expect(changelogUrl('  1.2.3  ')).toBe(`${CHANGELOG}#v1.2.3`)
  })

  test('프리릴리즈 태그도 그대로 만든다', () => {
    expect(changelogUrl('1.0.0-beta.1')).toBe(`${CHANGELOG}#v1.0.0-beta.1`)
  })

  // 앵커가 어긋나느니 목록 맨 위에서 시작하는 편이 낫다.
  test('버전을 모르면 앵커 없이 변경 이력으로 보낸다', () => {
    expect(changelogUrl(undefined)).toBe(CHANGELOG)
    expect(changelogUrl('')).toBe(CHANGELOG)
    expect(changelogUrl('   ')).toBe(CHANGELOG)
  })
})

// version은 원격 피드(latest-mac.yml) 유래 문자열이다 — 검증 없이 보간하면 깨진 링크나
// 엉뚱한 위치로 이어진다. 형식이 어긋나면 앵커를 붙이지 않는다.
describe('changelogUrl — 신뢰할 수 없는 입력', () => {
  test('경로 조작 문자가 섞이면 앵커 없이 폴백한다', () => {
    expect(changelogUrl('../../evil')).toBe(CHANGELOG)
    expect(changelogUrl('1.0.0/../../other')).toBe(CHANGELOG)
  })

  test('버전 형식이 아니면 앵커 없이 폴백한다', () => {
    expect(changelogUrl('latest')).toBe(CHANGELOG)
    expect(changelogUrl('1.0')).toBe(CHANGELOG)
    expect(changelogUrl('v 1.0.0')).toBe(CHANGELOG)
  })
})

// 자동 업데이트가 이미 실패한 상황에서 쓰는 링크다. 설치 파일을 쥐여주는 것이 목적이라
// 사이트 배포 성공에 의존하지 않는 GitHub 릴리즈로 보낸다.
describe('releasesPageUrl', () => {
  test('GitHub 릴리즈 목록을 가리킨다', () => {
    expect(releasesPageUrl()).toBe(RELEASES)
  })
})
