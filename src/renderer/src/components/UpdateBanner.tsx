import { useEffect, useState } from 'react'
import type { UpdateCheckResult, UpdateProgress } from '../../../shared/types'
import { releaseNotesUrl } from '../../../shared/release'
import { useMeetings } from '../state/meetings'
import { shouldShowUpdateBanner, updateVersionKey } from '../state/update-banner'

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// 설치 가드 오류(리뷰 Fix Critical) — main의 update:download가 canInstallUpdate 결과로 던진
// 오류 코드를 사용자 문구로 옮긴다. SettingsModal과 동일한 매핑을 공유한다.
function installGuardMessage(e: unknown): string | null {
  const msg = errMessage(e)
  if (msg.includes('recording_in_progress')) return '녹음 중에는 업데이트할 수 없습니다. 회의 종료 후 다시 시도하세요.'
  if (msg.includes('pipeline_in_progress')) return '회의록 처리 중입니다. 완료 후 다시 시도하세요.'
  return null
}

// 새 버전 알림 배너(v0.4.0 ③b) — 오너 확정 UX: 팝업 알림 → [업데이트] 클릭 → 적용. 기존
// setup-panel 톤(카드·그림자·라운드)을 재사용하되, 우측 하단은 SetupPanel이 이미 쓰고 있어
// 우측 상단에 고정한다. [나중에]는 그 버전만 세션 내 재알림하지 않는다(새 버전은 다시 뜬다).
export function UpdateBanner(): React.JSX.Element | null {
  const [available, setAvailable] = useState<UpdateCheckResult | null>(null)
  // [나중에]는 그 버전에만 적용한다 — boolean 래치면 한 번 미룬 뒤 새 버전 알림이 영영 안 뜬다.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { view } = useMeetings()
  const isRecording = view.kind === 'recording'

  useEffect(() => {
    const off = window.minuting.onUpdateAvailable((r) => {
      if (r.available) setAvailable(r)
    })
    // 구독 전에 이미 감지됐을 수 있다(main의 기동 확인이 STARTUP_CHECK_DELAY_MS 뒤라 앞설 수 있다)
    // — 보관된 결과를 한 번 되찾는다. 먼저 온 이벤트를 늦게 도착한 보관값이 덮지 않도록 prev를 우선한다.
    window.minuting
      .getLatestUpdate()
      .then((r) => {
        if (r?.available) setAvailable((prev) => prev ?? r)
      })
      // 이 조회가 실패하면 놓친 알림을 되찾을 수 없다 — 조용히 넘기지 않는다(다음 주기 확인이 만회).
      .catch((e) => console.error('[updater] 보관된 업데이트 조회 실패:', e instanceof Error ? e.message : e))
    return () => {
      off()
    }
  }, [])

  useEffect(() => {
    const off = window.minuting.onUpdateProgress(setProgress)
    return () => {
      off()
    }
  }, [])

  if (!shouldShowUpdateBanner(available, dismissedKey) || available === null) return null

  const startUpdate = (): void => {
    setError(null)
    setDownloading(true)
    window.minuting.downloadUpdate().catch((e) => {
      setDownloading(false)
      setError(installGuardMessage(e) ?? errMessage(e))
    })
  }

  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.transferred / progress.total) * 100)) : 0

  return (
    <div className="update-banner">
      <p className="update-banner-title">새 버전 v{available.version}가 있습니다</p>
      <button
        type="button"
        className="link-btn"
        // 사용자가 클릭하고 기다리는 동작이라 실패를 삼키지 않는다 — 대신 갈 곳을 알려준다.
        onClick={() =>
          window.minuting
            .openExternal(releaseNotesUrl(available.version))
            .catch(() => setError('브라우저를 열 수 없습니다. github.com/git-artinus/minit/releases 에서 확인하세요.'))
        }
      >
        릴리즈 노트 보기
      </button>

      {!downloading && (
        <div className="setting-path-row">
          <button
            type="button"
            className="btn-primary"
            onClick={startUpdate}
            disabled={isRecording}
            title={isRecording ? '녹음 중에는 업데이트할 수 없습니다. 회의 종료 후 다시 시도하세요.' : undefined}
          >
            업데이트
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setDismissedKey(updateVersionKey(available))}
          >
            나중에
          </button>
        </div>
      )}

      {downloading && !error && (
        <>
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="env-progress-label">다운로드 중… {percent}% (완료되면 자동으로 재시작합니다)</p>
        </>
      )}

      {error && <p className="setting-error">업데이트 실패: {error}</p>}
    </div>
  )
}
