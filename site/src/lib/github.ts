import type { GitHubRelease } from './releases'

const REPO = 'git-artinus/minit'

async function ghFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  // Actions에서는 GITHUB_TOKEN으로 레이트리밋이 60/h → 1000/h 로 올라간다.
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`https://api.github.com${path}`, { headers })
  if (!res.ok) {
    throw new Error(
      `GitHub API ${path} 실패: ${res.status} ${res.statusText}. ` +
        '다운로드 링크 없는 랜딩페이지는 배포하지 않는다.'
    )
  }
  return (await res.json()) as T
}

export function fetchLatestRelease(): Promise<GitHubRelease> {
  return ghFetch<GitHubRelease>(`/repos/${REPO}/releases/latest`)
}

export function fetchAllReleases(): Promise<GitHubRelease[]> {
  return ghFetch<GitHubRelease[]>(`/repos/${REPO}/releases?per_page=100`)
}
