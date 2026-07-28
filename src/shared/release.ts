// 릴리즈 노트는 GitHub Releases의 버전 태그 페이지다. 태그 규칙은 v 접두사(v0.9.0).
// electron-builder.yml의 publish(owner/repo)와 같은 값을 두 곳에서 관리하게 되는데,
// package.json에 repository 필드가 없어 런타임 단일 출처가 없다 — 레포 이전 시 함께 고쳐야 한다.
const RELEASES_BASE = 'https://github.com/git-artinus/minit/releases'

// v1.2.3 / v1.2.3-beta.1 형태만 태그로 인정한다. version은 원격 피드(latest-mac.yml) 유래
// 문자열이라, 검증 없이 경로에 보간하면 깨진 링크나 엉뚱한 경로로 이어질 수 있다.
const TAG_RE = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/

/**
 * 특정 버전의 릴리즈 노트 URL. electron-updater가 주는 version은 접두사 없는 '0.9.0'이지만
 * 태그는 'v0.9.0'이라 보정한다. 버전을 모르거나 형식이 어긋나면 릴리즈 목록으로 보낸다 —
 * 없는 태그로 404를 띄우느니 사용자의 질문("무엇이 바뀌었나")에 답할 수 있는 페이지가 낫다.
 */
export function releaseNotesUrl(version?: string): string {
  const trimmed = (version ?? '').trim()
  if (trimmed === '') return RELEASES_BASE
  const tag = trimmed.startsWith('v') ? trimmed : `v${trimmed}`
  if (!TAG_RE.test(tag)) return RELEASES_BASE
  return `${RELEASES_BASE}/tag/${encodeURIComponent(tag)}`
}
