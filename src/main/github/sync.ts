import { isValidMeetingFilename } from '../../shared/meeting-file'

type UploadFn = (
  token: string,
  repo: string,
  filename: string,
  content: string,
  fetchImpl: typeof fetch
) => Promise<void>

type DeleteFn = (token: string, repo: string, filename: string, fetchImpl: typeof fetch) => Promise<void>

export interface SyncMeetingDeps {
  filename: string
  content: string
  token: string
  repo: string
  upload: UploadFn
  fetchImpl: typeof fetch
  // 실패 시 settings.pendingUploads에 filename을 추가하는 콜백(호출부가 저장을 책임진다).
  onFailure: (filename: string) => void
  log: (...args: unknown[]) => void
}

// 회의록 저장 성공 후 GitHub 업로드 후처리 진입점. Slack의 sendSlackNotification과 동일한
// 실패 격리 원칙을 따른다 — 어떤 이유로도 절대 throw하지 않는다(동기 예외·비동기 실패 모두
// 이 함수 내부에서 흡수). 토큰·URL 원문은 로그에 남기지 않는다(에러 메시지만 남긴다).
export function syncMeeting(deps: SyncMeetingDeps): void {
  try {
    void deps.upload(deps.token, deps.repo, deps.filename, deps.content, deps.fetchImpl).catch((e) => {
      deps.log('[github] 회의록 업로드 실패:', e instanceof Error ? e.message : e)
      deps.onFailure(deps.filename)
    })
  } catch (e) {
    deps.log('[github] 회의록 업로드 요청 실패:', e instanceof Error ? e.message : e)
    deps.onFailure(deps.filename)
  }
}

export interface RetryPendingUploadsDeps {
  pending: string[]
  token: string
  repo: string
  // 원본 회의록 파일을 읽어 내용을 반환한다. 파일이 사라졌으면(삭제 등) null.
  readContent: (filename: string) => string | null
  upload: UploadFn
  fetchImpl: typeof fetch
  log: (...args: unknown[]) => void
}

// meetings:list 호출 시(로그인+레포 설정 상태) 미업로드 큐를 재시도한다. 큐에서 제거해도 되는
// 파일명 목록(업로드 성공분 + 원본이 사라져 더 재시도할 수 없는 항목)을 반환한다 — 실패분은
// 반환값에 포함하지 않는다(호출부가 "그 시점의 최신 pendingUploads에서 이 목록만 제거"하는
// 함수형 갱신에 바로 쓸 수 있도록 — retryPendingUploadsAndSave 참조). 개별 파일 실패가 나머지
// 재시도를 막지 않도록 순차 처리하고 예외를 각자 흡수한다(전체가 throw하지 않는다).
export async function retryPendingUploads(deps: RetryPendingUploadsDeps): Promise<string[]> {
  const succeeded: string[] = []
  for (const filename of deps.pending) {
    try {
      const content = deps.readContent(filename)
      if (content === null) {
        succeeded.push(filename) // 원본 파일이 사라짐 — 재시도 불가하므로 큐에서 조용히 제거
        continue
      }
      await deps.upload(deps.token, deps.repo, filename, content, deps.fetchImpl)
      succeeded.push(filename)
    } catch (e) {
      deps.log('[github] 재시도 업로드 실패:', e instanceof Error ? e.message : e)
    }
  }
  return succeeded
}

export interface RetryPendingUploadsAndSaveDeps extends RetryPendingUploadsDeps {
  // 저장 시점의 최신 pendingUploads를 조회한다 — 재시도 도중(각 업로드 사이) pipeline:run 실패로
  // 큐에 새 항목이 추가됐을 수 있으므로, 반드시 저장 직전에 다시 조회해 그 값을 기준으로 병합한다.
  getCurrentPending: () => string[]
  // 병합된 배열을 저장한다(설정 갱신 + 디스크 반영은 호출부 책임).
  savePending: (updated: string[]) => void
}

// retryPendingUploads 실행 후 "성공한 파일명만 제거"하는 함수형 갱신을 수행한다(리뷰 Fix 1 —
// lost-update 레이스 수정). 스냅샷을 통째로 덮어쓰지 않고, 저장 직전에 getCurrentPending()으로
// 다시 읽은 최신 값에서 성공분만 filter로 제거해 저장한다 — 재시도 도중 큐에 추가된 항목은
// 항상 보존된다.
export async function retryPendingUploadsAndSave(deps: RetryPendingUploadsAndSaveDeps): Promise<void> {
  const succeeded = await retryPendingUploads(deps)
  if (succeeded.length === 0) return

  const succeededSet = new Set(succeeded)
  const current = deps.getCurrentPending()
  const updated = current.filter((f) => !succeededSet.has(f))
  if (updated.length !== current.length) {
    deps.savePending(updated)
  }
}

export interface RetryPendingDeletesDeps {
  pending: string[]
  token: string
  repo: string
  deleteRemote: DeleteFn
  fetchImpl: typeof fetch
  log: (...args: unknown[]) => void
}

// meetings:list 호출 시 원격 삭제 실패분(settings.pendingDeletes)을 재시도한다. 큐에서 제거해도
// 되는 파일명(삭제 성공 + 애초에 원격 API로 보낼 수 없는 잘못된 이름)을 반환한다 — 실패분은
// 제외해 다음 주기에 다시 시도한다. retryPendingUploads와 동일하게 개별 실패를 흡수하며 전체가
// throw하지 않는다.
export async function retryPendingDeletes(deps: RetryPendingDeletesDeps): Promise<string[]> {
  const succeeded: string[] = []
  for (const filename of deps.pending) {
    // 잘못된 이름은 재시도해도 영원히 실패한다 — 큐에 무한히 남지 않도록 조용히 제거한다.
    if (!isValidMeetingFilename(filename)) {
      succeeded.push(filename)
      continue
    }
    try {
      await deps.deleteRemote(deps.token, deps.repo, filename, deps.fetchImpl)
      succeeded.push(filename)
    } catch (e) {
      deps.log('[github] 재시도 삭제 실패:', e instanceof Error ? e.message : e)
    }
  }
  return succeeded
}

export interface RetryPendingDeletesAndSaveDeps extends RetryPendingDeletesDeps {
  getCurrentPending: () => string[]
  savePending: (updated: string[]) => void
}

// retryPendingUploadsAndSave와 같은 lost-update 방지 규칙 — 저장 직전에 최신 큐를 다시 읽어
// 성공분만 제거한다(재시도 도중 새로 추가된 삭제 대기 항목을 덮어쓰지 않는다).
export async function retryPendingDeletesAndSave(deps: RetryPendingDeletesAndSaveDeps): Promise<void> {
  const succeeded = await retryPendingDeletes(deps)
  if (succeeded.length === 0) return

  const succeededSet = new Set(succeeded)
  const current = deps.getCurrentPending()
  const updated = current.filter((f) => !succeededSet.has(f))
  if (updated.length !== current.length) {
    deps.savePending(updated)
  }
}

export interface PullRemoteMeetingsDeps {
  // token/repo/fetchImpl은 호출부(ipc.ts)가 클로저로 미리 묶어 넘긴다 — 이 모듈은 순수 로직만
  // 다룬다.
  listRemote: () => Promise<Array<{ name: string; sha: string }>>
  download: (filename: string) => Promise<string>
  localExists: (filename: string) => boolean
  // 사용자가 지웠지만 원격 삭제가 아직 끝나지 않은 파일(settings.pendingDeletes). 여기 걸리면
  // 원격에 남아 있어도 내려받지 않는다 — 재시도가 성공하기 전까지 삭제한 회의록이 부활하는 것을
  // 막는 유일한 방어선이다.
  isDeleted: (filename: string) => boolean
  // writeLocal 계약(리뷰 Fix 1 — 무유실 원자 보장): 반드시 배타적 생성으로 구현해야 한다
  // (예: fs.writeFileSync(path, content, { flag: 'wx' })). localExists 확인과 실제 쓰기 사이의
  // 레이스 윈도우에서 로컬 쪽이 먼저 같은 파일을 만들었다면 EEXIST 성격의 예외를 던져야 하며,
  // pullRemoteMeetings는 이를 "레이스에서 로컬 승리 — 스킵"으로 흡수한다(반환 목록에서 제외,
  // 로그 한 줄만 남기고 절대 로컬 파일을 덮어쓰지 않는다).
  writeLocal: (filename: string, content: string) => void
  log: (...args: unknown[]) => void
}

// 1주기(스로틀 간격)당 다운로드 상한(리뷰 Fix 3) — 초과분은 이번 주기에 처리하지 않고 다음
// 스로틀 주기로 이월한다(다음 meetings:list 호출에서 localExists가 false인 채로 다시 후보에
// 포함되므로 별도 상태 없이 자연히 재시도된다).
const MAX_DOWNLOADS_PER_CYCLE = 30
// 동시 다운로드 병렬 수(리뷰 Fix 3) — GitHub API 레이트리밋·로컬 I/O 부하를 고려한 상한.
const DOWNLOAD_CONCURRENCY = 4

function isEExistError(e: unknown): boolean {
  return e instanceof Error && (e as NodeJS.ErrnoException).code === 'EEXIST'
}

// meetings:list 호출 시(로그인+레포 설정+스로틀 통과) 원격 minit/*.md 중 로컬에 없는 파일명만
// 내려받아 저장한다. 로컬 우선·무유실 원칙 — 동일 파일명이 로컬에 이미 있으면 절대 덮어쓰지
// 않는다(다운로드 자체를 하지 않고 건너뛴다). 목록 조회 실패·개별 다운로드 실패 모두 격리한다:
// syncMeeting과 동일한 원칙으로 절대 throw하지 않는다. 저장에 성공한 파일명 배열을 반환한다.
// 최대 DOWNLOAD_CONCURRENCY개씩 병렬로 내려받으며, 1주기 최대 MAX_DOWNLOADS_PER_CYCLE개로
// 제한한다(리뷰 Fix 3).
export async function pullRemoteMeetings(deps: PullRemoteMeetingsDeps): Promise<string[]> {
  const saved: string[] = []

  let remote: Array<{ name: string; sha: string }>
  try {
    remote = await deps.listRemote()
  } catch (e) {
    deps.log('[github] 원격 회의록 목록 조회 실패:', e instanceof Error ? e.message : e)
    return saved
  }

  const candidates = remote.filter((file) => !deps.localExists(file.name) && !deps.isDeleted(file.name))

  let targets = candidates
  if (candidates.length > MAX_DOWNLOADS_PER_CYCLE) {
    deps.log(
      `[github] 다운로드 상한(${MAX_DOWNLOADS_PER_CYCLE}개) 도달 — 이번 주기는 ${MAX_DOWNLOADS_PER_CYCLE}개만 처리하고 나머지 ${
        candidates.length - MAX_DOWNLOADS_PER_CYCLE
      }개는 다음 주기로 이월합니다`
    )
    targets = candidates.slice(0, MAX_DOWNLOADS_PER_CYCLE)
  }

  const downloadOne = async (file: { name: string; sha: string }): Promise<void> => {
    try {
      const content = await deps.download(file.name)
      deps.writeLocal(file.name, content)
      saved.push(file.name)
    } catch (e) {
      if (isEExistError(e)) {
        deps.log('[github] 로컬 우선 — 레이스에서 로컬 승리, 스킵:', file.name)
        return
      }
      deps.log('[github] 원격 회의록 다운로드 실패:', file.name, e instanceof Error ? e.message : e)
    }
  }

  // 워커 풀 패턴 — DOWNLOAD_CONCURRENCY개의 워커가 targets 배열을 공유 인덱스로 순차 소비하며
  // 각자 다음 파일을 즉시 이어받는다(하나가 빨리 끝나면 노는 시간 없이 다음 항목을 가져간다).
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < targets.length) {
      const file = targets[nextIndex++]
      await downloadOne(file)
    }
  }
  const workerCount = Math.min(DOWNLOAD_CONCURRENCY, targets.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return saved
}

// pull 스로틀 판정 순수 함수. lastPulledAt=0(한 번도 pull한 적 없음)이면 간격과 무관하게 즉시
// true — 앱 시작 직후 첫 meetings:list에서 곧바로 pull이 실행되도록 한다. now()를 인자로 받아
// 테스트에서 시간을 주입할 수 있게 한다.
export function shouldPull(lastPulledAt: number, now: number, intervalMs = 60_000): boolean {
  if (lastPulledAt === 0) return true
  return now - lastPulledAt >= intervalMs
}
