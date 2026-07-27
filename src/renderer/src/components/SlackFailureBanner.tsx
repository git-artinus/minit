import { useEffect, useState } from 'react'
import type { SlackSendFailure } from '../../../shared/types'
import { slackFailureText } from './slack-failure'

// 자동 Slack 발송 실패 알림. 재시도 버튼을 두지 않는다 — 다시 보내려면 회의록 상세의 공유
// 모달에서 채널을 골라 직접 전송한다. 위치는 상단 중앙으로, 우측 상단(UpdateBanner)·우측
// 하단(SetupPanel)과 겹치지 않게 한다.
export function SlackFailureBanner(): React.JSX.Element | null {
  const [failure, setFailure] = useState<SlackSendFailure | null>(null)

  useEffect(() => {
    const off = window.minuting.onSlackSendFailed(setFailure)
    return () => {
      off()
    }
  }, [])

  if (!failure) return null

  return (
    <div className="toast-banner" role="alert">
      <p>{slackFailureText(failure)}</p>
      <button type="button" className="btn-ghost" onClick={() => setFailure(null)}>
        닫기
      </button>
    </div>
  )
}
