import type { UpdateCheckResult, UpdateProgress } from '../shared/types'

export type { UpdateCheckResult, UpdateProgress }

// electron-updater의 실제 autoUpdater(AppUpdater)는 EventEmitter를 상속하며 update-available/
// update-not-available/update-downloaded/download-progress/error 이벤트를 낸다. 이 인터페이스는
// 그중 이 모듈이 실제로 쓰는 부분만 좁혀 정의한 포트(port) — electron-updater 자체를 여기 직접
// 타입으로 물지 않아 순수 로직을 electron 의존 없이 목(mock)으로 테스트할 수 있다.
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  on(event: 'download-progress', listener: (progress: UpdateProgress) => void): unknown
  once(event: 'update-available', listener: (info: { version: string }) => void): unknown
  once(event: 'update-not-available', listener: (info: unknown) => void): unknown
  once(event: 'update-downloaded', listener: (event: unknown) => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  removeListener(
    event: 'download-progress' | 'update-available' | 'update-not-available' | 'update-downloaded' | 'error',
    listener: (...args: never[]) => void
  ): unknown
}

export interface UpdaterDeps {
  autoUpdater: AutoUpdaterLike
  // dev(app.isPackaged=false)에서는 electron-updater가 latest-mac.yml 등 배포 메타를 찾지 못해
  // 동작하지 않는다 — 패키징된 앱에서만 실제 체크를 시도한다.
  isPackaged: () => boolean
}

export interface Updater {
  checkForUpdates(): Promise<UpdateCheckResult>
  downloadAndInstall(onProgress?: (progress: UpdateProgress) => void): Promise<void>
}

export type InstallGuardReason = 'recording_in_progress' | 'pipeline_in_progress'
export type InstallGuardResult = { ok: true } | { ok: false; reason: InstallGuardReason }

export type UpdateErrorCode = 'feed_unreachable' | 'other'

// 저장소 비공개 상태 업데이트 안내(v0.4.1) — 자동 업데이트 피드(GitHub Releases)는 레포가
// public이어야 응답한다. private 동안에는 latest-mac.yml 조회가 404/HttpError·DNS 실패
// (ENOTFOUND)·연결 거부(ECONNREFUSED)·API rate limit 중 하나로 실패한다 — 이를 하나의
// feed_unreachable로 묶어 렌더러가 "오류"가 아닌 "안내" 톤으로 보여줄 수 있게 한다. 그 외
// 오류(파싱 실패 등)는 other로 분류해 기존 오류 표시를 그대로 유지한다.
export function classifyUpdateError(e: unknown): UpdateErrorCode {
  if (!(e instanceof Error)) return 'other'

  const statusCode = (e as { statusCode?: unknown }).statusCode
  if (typeof statusCode === 'number' && (statusCode === 404 || statusCode === 403)) return 'feed_unreachable'

  const haystack = `${e.name} ${e.message}`.toLowerCase()
  const feedUnreachablePatterns = [
    'httperror',
    '404',
    'enotfound',
    'econnrefused',
    'rate limit',
    'ratelimit',
    'rate-limit'
  ]
  if (feedUnreachablePatterns.some((p) => haystack.includes(p))) return 'feed_unreachable'

  return 'other'
}

// 설치 가드(리뷰 Fix Critical) — downloadAndInstall은 다운로드 완료 즉시 quitAndInstall로 앱을
// 강제 재시작한다. 녹음 중이거나(오디오 파이프라인 미저장) 전사·요약 파이프라인 처리 중에는
// 진행 중인 작업이 통째로 유실될 수 있어 이를 막는다. electron 비의존 순수 함수로 분리해
// ipc.ts(recording 상태·runningPipelines 크기 보유)가 update:download 첫 줄에서 호출한다.
export function canInstallUpdate(state: { isRecording: boolean; runningPipelineCount: number }): InstallGuardResult {
  if (state.isRecording) return { ok: false, reason: 'recording_in_progress' }
  if (state.runningPipelineCount > 0) return { ok: false, reason: 'pipeline_in_progress' }
  return { ok: true }
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const { autoUpdater, isPackaged } = deps
  // 수동(설정 버튼) 확인 후 사용자가 명시적으로 [업데이트]를 눌러야 다운로드·설치가 시작되도록
  // 강제한다 — 백그라운드 자동 다운로드/자동 설치는 오너 확정 UX(팝업 → 버튼 → 적용)와 어긋난다.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  async function checkForUpdates(): Promise<UpdateCheckResult> {
    if (!isPackaged()) return { available: false }

    return new Promise<UpdateCheckResult>((resolve, reject) => {
      const cleanup = (): void => {
        autoUpdater.removeListener('update-available', onAvailable)
        autoUpdater.removeListener('update-not-available', onNotAvailable)
        autoUpdater.removeListener('error', onError)
      }
      const onAvailable = (info: { version: string }): void => {
        cleanup()
        resolve({ available: true, version: info.version })
      }
      const onNotAvailable = (): void => {
        cleanup()
        resolve({ available: false })
      }
      const onError = (err: Error): void => {
        cleanup()
        reject(err)
      }

      autoUpdater.once('update-available', onAvailable)
      autoUpdater.once('update-not-available', onNotAvailable)
      autoUpdater.once('error', onError)
      autoUpdater.checkForUpdates().catch(onError)
    })
  }

  async function downloadAndInstall(onProgress?: (progress: UpdateProgress) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        autoUpdater.removeListener('download-progress', onProgressEvt)
        autoUpdater.removeListener('update-downloaded', onDownloaded)
        autoUpdater.removeListener('error', onError)
      }
      const onProgressEvt = (progress: UpdateProgress): void => onProgress?.(progress)
      const onDownloaded = (): void => {
        cleanup()
        autoUpdater.quitAndInstall()
        resolve()
      }
      const onError = (err: Error): void => {
        cleanup()
        reject(err)
      }

      autoUpdater.on('download-progress', onProgressEvt)
      autoUpdater.once('update-downloaded', onDownloaded)
      autoUpdater.once('error', onError)
      autoUpdater.downloadUpdate().catch(onError)
    })
  }

  return { checkForUpdates, downloadAndInstall }
}
