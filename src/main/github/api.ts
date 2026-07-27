import { fetchWithTimeout } from '../../shared/fetch-timeout'
import { isValidMeetingFilename } from '../../shared/meeting-file'

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json'
  }
}

export async function fetchViewer(
  token: string,
  fetchImpl: typeof fetch,
  timeoutMs = 10_000
): Promise<{ login: string }> {
  const res = await fetchWithTimeout(fetchImpl, 'https://api.github.com/user', { headers: authHeaders(token) }, timeoutMs)
  if (!res.ok) throw new Error(`GitHub 사용자 조회 실패: ${res.status}`)
  const data = (await res.json()) as { login: string }
  return { login: data.login }
}

// affiliation 파라미터 없이 /user/repos는 기본적으로 owner+collaborator+organization_member를
// 모두 포함한다. 첫 페이지 100개(sort=pushed)면 MVP 충분(스펙 명시).
export async function listRepos(token: string, fetchImpl: typeof fetch, timeoutMs = 10_000): Promise<string[]> {
  const res = await fetchWithTimeout(
    fetchImpl,
    'https://api.github.com/user/repos?per_page=100&sort=pushed',
    { headers: authHeaders(token) },
    timeoutMs
  )
  if (!res.ok) throw new Error(`GitHub 레포 목록 조회 실패: ${res.status}`)
  const data = (await res.json()) as Array<{ full_name: string }>
  return data.map((r) => r.full_name)
}

async function getExistingSha(
  token: string,
  contentsUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string | undefined> {
  const res = await fetchWithTimeout(fetchImpl, contentsUrl, { headers: authHeaders(token) }, timeoutMs)
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`GitHub 기존 파일 조회 실패: ${res.status}`)
  const data = (await res.json()) as { sha?: string }
  return data.sha
}

// repos/{repo}/contents/minit/{filename}에 PUT한다. 기존 파일이 있으면(sha 조회 성공) 갱신,
// 없으면(404) 새로 만든다. 409/422(동시 갱신으로 인한 sha 불일치)는 1회 재조회 후 재시도하고,
// 그래도 실패하면 throw한다(호출부가 실패 격리를 책임진다 — sync.ts 참조).
export async function uploadMeeting(
  token: string,
  repo: string,
  filename: string,
  content: string,
  fetchImpl: typeof fetch,
  timeoutMs = 10_000
): Promise<void> {
  if (!isValidMeetingFilename(filename)) throw new Error(`invalid filename: ${filename}`)

  const contentsUrl = `https://api.github.com/repos/${repo}/contents/minit/${encodeURIComponent(filename)}`
  const buildBody = (sha?: string): string =>
    JSON.stringify({
      message: `docs(minit): ${filename} 회의록 추가`,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      ...(sha ? { sha } : {})
    })
  const put = (sha?: string): Promise<Response> =>
    fetchWithTimeout(fetchImpl, contentsUrl, { method: 'PUT', headers: authHeaders(token), body: buildBody(sha) }, timeoutMs)

  const sha = await getExistingSha(token, contentsUrl, fetchImpl, timeoutMs)
  let res = await put(sha)

  if (res.status === 409 || res.status === 422) {
    const retrySha = await getExistingSha(token, contentsUrl, fetchImpl, timeoutMs)
    res = await put(retrySha)
  }

  if (!res.ok) throw new Error(`GitHub 회의록 업로드 실패: ${res.status}`)
}

// repos/{repo}/contents/minit/{filename}을 DELETE한다. GitHub Contents API는 삭제에도 현재
// blob sha를 요구하므로 먼저 조회한다. 원격에 파일이 없으면(sha 조회 404) 이미 목표 상태이므로
// 조용히 성공으로 끝낸다 — 재시도 큐(pendingDeletes)가 같은 파일을 두 번 지우려 해도 안전하다.
export async function deleteRemoteMeeting(
  token: string,
  repo: string,
  filename: string,
  fetchImpl: typeof fetch,
  timeoutMs = 10_000
): Promise<void> {
  if (!isValidMeetingFilename(filename)) throw new Error(`invalid filename: ${filename}`)

  const contentsUrl = `https://api.github.com/repos/${repo}/contents/minit/${encodeURIComponent(filename)}`
  const sha = await getExistingSha(token, contentsUrl, fetchImpl, timeoutMs)
  if (!sha) return

  const res = await fetchWithTimeout(
    fetchImpl,
    contentsUrl,
    {
      method: 'DELETE',
      headers: authHeaders(token),
      body: JSON.stringify({ message: `docs(minit): ${filename} 회의록 삭제`, sha })
    },
    timeoutMs
  )
  if (!res.ok) throw new Error(`GitHub 회의록 삭제 실패: ${res.status}`)
}

export interface RemoteMeetingFile {
  name: string
  sha: string
}

// GET repos/{repo}/contents/minit로 원격 회의록 폴더의 파일 목록을 가져온다. 폴더가 없으면(404)
// 빈 배열(아직 아무도 업로드하지 않은 상태와 동일하게 취급). isValidMeetingFilename을 통과하지
// 못하는 이름은 방어적으로 제외한다 — GitHub 쪽에 임의 파일이 섞여도 로컬 다운로드 대상에서 제외.
// type !== 'file'인 항목(디렉터리 등)도 제외한다(리뷰 Fix 4) — GitHub contents API는 폴더 등도
// 같은 배열에 섞어 반환하므로, 이름이 우연히 .md로 끝나더라도 실제 파일이 아니면 다운로드 대상이
// 아니다.
export async function listRemoteMeetings(
  token: string,
  repo: string,
  fetchImpl: typeof fetch,
  timeoutMs = 10_000
): Promise<RemoteMeetingFile[]> {
  const res = await fetchWithTimeout(
    fetchImpl,
    `https://api.github.com/repos/${repo}/contents/minit`,
    { headers: authHeaders(token) },
    timeoutMs
  )
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`GitHub 원격 회의록 목록 조회 실패: ${res.status}`)
  const data = (await res.json()) as Array<{ name: string; sha: string; type?: string }>
  return data
    .filter((f) => f.type === 'file' && f.name.endsWith('.md') && isValidMeetingFilename(f.name))
    .map((f) => ({ name: f.name, sha: f.sha }))
}

// GET repos/{repo}/contents/minit/{filename}로 파일 내용을 base64로 받아 디코드한다.
export async function downloadRemoteMeeting(
  token: string,
  repo: string,
  filename: string,
  fetchImpl: typeof fetch,
  timeoutMs = 10_000
): Promise<string> {
  const contentsUrl = `https://api.github.com/repos/${repo}/contents/minit/${encodeURIComponent(filename)}`
  const res = await fetchWithTimeout(fetchImpl, contentsUrl, { headers: authHeaders(token) }, timeoutMs)
  if (!res.ok) throw new Error(`GitHub 회의록 다운로드 실패: ${res.status}`)
  const data = (await res.json()) as { content: string }
  return Buffer.from(data.content, 'base64').toString('utf-8')
}
