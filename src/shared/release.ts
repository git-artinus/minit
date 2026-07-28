// 릴리즈 노트는 GitHub Releases의 버전 태그 페이지다. 태그 규칙은 v 접두사(v0.9.0).
const RELEASES_BASE = 'https://github.com/git-artinus/minit/releases'

/**
 * 특정 버전의 릴리즈 노트 URL. electron-updater가 주는 version은 접두사 없는 '0.9.0'이지만
 * 태그는 'v0.9.0'이라 보정한다. 버전을 모르면 릴리즈 목록으로 보낸다 — 링크가 깨지느니 낫다.
 */
export function releaseNotesUrl(version?: string): string {
  const trimmed = (version ?? '').trim()
  if (trimmed === '') return RELEASES_BASE
  const tag = trimmed.startsWith('v') ? trimmed : `v${trimmed}`
  return `${RELEASES_BASE}/tag/${tag}`
}
