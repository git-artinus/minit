export type GitHubAsset = { name: string; browser_download_url: string; size: number }

export type GitHubRelease = {
  tag_name: string
  body: string | null
  published_at: string
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: GitHubAsset[]
}

export type Download = { version: string; url: string; sizeMB: number }

export type ReleaseEntry = {
  version: string
  publishedAt: string
  bodyMarkdown: string
  htmlUrl: string
  dmgUrl: string | null
}

const stripV = (tag: string): string => tag.replace(/^v/, '')

// .dmg.blockmap 은 electron-updater 산출물이다. endsWith('.dmg') 로만 거르면 걸리지 않지만
// 의도를 드러내기 위해 명시적으로 배제한다.
const isDmg = (a: GitHubAsset): boolean => a.name.endsWith('.dmg') && !a.name.endsWith('.blockmap')

export function selectPublished(releases: GitHubRelease[]): GitHubRelease[] {
  return releases
    .filter((r) => !r.draft && !r.prerelease)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
}

export function findDmgAsset(release: GitHubRelease): GitHubAsset {
  const found = release.assets.filter(isDmg)
  if (found.length !== 1) {
    throw new Error(
      `${release.tag_name}: dmg 에셋이 정확히 1개여야 하는데 ${found.length}개다. ` +
        `에셋 목록: ${release.assets.map((a) => a.name).join(', ')}`
    )
  }
  return found[0]
}

export function toDownload(release: GitHubRelease): Download {
  const dmg = findDmgAsset(release)
  return {
    version: stripV(release.tag_name),
    url: dmg.browser_download_url,
    sizeMB: Math.round(dmg.size / 1024 / 1024)
  }
}

export function toReleaseEntries(releases: GitHubRelease[]): ReleaseEntry[] {
  return selectPublished(releases).map((r) => {
    const dmg = r.assets.filter(isDmg)
    return {
      version: stripV(r.tag_name),
      publishedAt: r.published_at.slice(0, 10),
      bodyMarkdown: r.body ?? '',
      htmlUrl: r.html_url,
      dmgUrl: dmg.length === 1 ? dmg[0].browser_download_url : null
    }
  })
}
