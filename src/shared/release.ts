// 변경 이력은 랜딩페이지가 GitHub Releases를 읽어 그리는 자체 화면이다(site/src/pages/changelog.astro).
// 버전마다 `id="v0.13.0"` 앵커가 있어 특정 버전으로 바로 보낼 수 있다.
// electron-builder.yml의 publish(owner/repo)·astro.config.mjs의 site+base와 같은 값을 여러 곳에서
// 관리하게 되는데, package.json에 repository 필드가 없어 런타임 단일 출처가 없다 — 레포나 배포
// 주소를 옮기면 함께 고쳐야 한다.
const CHANGELOG_BASE = 'https://git-artinus.github.io/minit/changelog/'
const RELEASES_BASE = 'https://github.com/git-artinus/minit/releases'

// v1.2.3 / v1.2.3-beta.1 형태만 태그로 인정한다. version은 원격 피드(latest-mac.yml) 유래
// 문자열이라, 검증 없이 경로에 보간하면 깨진 링크나 엉뚱한 경로로 이어질 수 있다.
const TAG_RE = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/

/**
 * 특정 버전의 변경 이력 URL. electron-updater가 주는 version은 접두사 없는 '0.9.0'이지만
 * 페이지 앵커는 'v0.9.0'이라 보정한다. 버전을 모르거나 형식이 어긋나면 앵커 없이 목록 맨 위로
 * 보낸다 — 어긋난 앵커로 엉뚱한 곳에 떨구느니 "무엇이 바뀌었나"에 답할 수 있는 화면이 낫다.
 *
 * 사이트는 릴리즈 발행 후 Pages 배포가 끝나야 새 버전을 싣는다. 그 사이(보통 1~2분)에 열면
 * 앵커가 없어 목록 맨 위에 머문다 — 자가 복구되는 지연이라 감수한다.
 */
export function changelogUrl(version?: string): string {
  const trimmed = (version ?? '').trim()
  if (trimmed === '') return CHANGELOG_BASE
  const tag = trimmed.startsWith('v') ? trimmed : `v${trimmed}`
  if (!TAG_RE.test(tag)) return CHANGELOG_BASE
  return `${CHANGELOG_BASE}#${tag}`
}

/**
 * GitHub 릴리즈 목록. 자동 업데이트가 반복 실패해 사용자가 설치 파일을 직접 받아야 할 때만 쓴다.
 * 변경 이력(사이트)으로 보내지 않는 이유: 이 링크가 뜨는 시점은 업데이터가 이미 깨진 상황이고,
 * 목적은 읽을거리가 아니라 dmg를 손에 쥐여주는 것이다. 여기까지 사이트 배포 성공에 걸어 둘 이유가 없다.
 */
export function releasesPageUrl(): string {
  return RELEASES_BASE
}
