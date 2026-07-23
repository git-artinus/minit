import { useEffect, useState } from 'react'
import type { UpdateCheckResult, UpdateProgress } from '../../../shared/types'
import { useMeetings } from '../state/meetings'

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
// 우측 상단에 고정한다. [나중에]는 세션 내(컴포넌트 상태) 재알림하지 않는다.
export function UpdateBanner(): React.JSX.Element | null {
  const [available, setAvailable] = useState<UpdateCheckResult | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { view } = useMeetings()
  const isRecording = view.kind === 'recording'

  useEffect(() => {
    const off = window.minuting.onUpdateAvailable((r) => {
      if (r.available) setAvailable(r)
    })
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

  if (!available || dismissed) return null

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
          <button type="button" className="btn-ghost" onClick={() => setDismissed(true)}>
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
