import { useEffect, useState } from 'react'
import type { Meeting, SlackChannel, SlackTokenState } from '../../../shared/types'
import { buildShareMarkdown, type ExportFormat } from '../../../shared/share-format'
import { SlackChannelSelect } from './SlackChannelSelect'
import { canShare, exportSavedMessage, slackBlockedReason, type ShareTarget } from './share-logic'

// 자동 발송(slack.ts)이 붙이는 것과 같은 힌트 — 실패 원인 중 사용자가 직접 고칠 수 있는 유일한 케이스다.
function withHint(message: string): string {
  return message.includes('not_in_channel') ? `${message} — 채널에 Minit 봇을 초대하세요` : message
}

export function ShareMeetingModal(props: { meeting: Meeting; onClose: () => void }): React.JSX.Element {
  const [target, setTarget] = useState<ShareTarget>('clipboard')
  const [channelId, setChannelId] = useState('')
  const [format, setFormat] = useState<ExportFormat>('md')
  const [channels, setChannels] = useState<SlackChannel[] | null>(null)
  const [slackTokenSaved, setSlackTokenSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const hasSummary = props.meeting.summary.trim() !== ''

  useEffect(() => {
    window.minuting
      .getSlackTokenState()
      .then((t: SlackTokenState) => setSlackTokenSaved(t.saved))
      .catch(() => {})
  }, [])

  // 드롭다운을 처음 열 때 목록을 지연 조회한다(설정·회의시작 모달과 동일 관례).
  const loadChannels = (): void => {
    if (channels) return
    window.minuting.listSlackChannels().then(setChannels).catch(() => {})
  }

  const select = (next: ShareTarget): void => {
    setTarget(next)
    setError(null)
    setDone(null)
  }

  const share = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      if (target === 'clipboard') {
        await window.minuting.writeClipboard(buildShareMarkdown(props.meeting))
        setDone('요약을 클립보드에 복사했습니다.')
      } else if (target === 'slack') {
        await window.minuting.shareMeetingToSlack(props.meeting.filename, channelId)
        setDone('Slack으로 전송했습니다.')
      } else {
        const result = await window.minuting.exportMeetingFile(props.meeting.filename, format)
        if (result.saved && result.path) setDone(exportSavedMessage(result.path))
      }
    } catch (e) {
      setError(withHint(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  const slackDisabled = !hasSummary || !slackTokenSaved
  const ready = canShare({ target, channelId, format }, hasSummary) && !(target === 'slack' && !slackTokenSaved)

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>회의록 공유</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="닫기">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="share-options">
          <label className="share-option">
            <input
              type="radio"
              name="share-target"
              checked={target === 'clipboard'}
              onChange={() => select('clipboard')}
            />
            <span>
              요약 클립보드 복사
              <span className="share-option-desc">요약과 항목들을 마크다운으로 복사합니다.</span>
            </span>
          </label>

          <label className={`share-option${slackDisabled ? ' disabled' : ''}`}>
            <input
              type="radio"
              name="share-target"
              disabled={slackDisabled}
              checked={target === 'slack'}
              onChange={() => select('slack')}
            />
            <span>
              Slack 채널로 전송
              <span className="share-option-desc">
                {!slackTokenSaved
                  ? '설정에서 Slack 봇 토큰을 먼저 등록하세요.'
                  : (slackBlockedReason(hasSummary) ?? '보낼 채널을 고르세요.')}
              </span>
            </span>
          </label>
          {target === 'slack' && (
            <div className="share-option-body">
              <SlackChannelSelect
                channels={channels}
                value={channelId}
                onFocus={loadChannels}
                onChange={setChannelId}
                leading={<option value="">채널 선택…</option>}
              />
            </div>
          )}

          <label className="share-option">
            <input type="radio" name="share-target" checked={target === 'file'} onChange={() => select('file')} />
            <span>
              파일로 내보내기
              <span className="share-option-desc">트랜스크립트까지 포함한 전체 회의록을 저장합니다.</span>
            </span>
          </label>
          {target === 'file' && (
            <div className="share-option-body segmented">
              <button
                type="button"
                className={`segmented-item${format === 'md' ? ' active' : ''}`}
                onClick={() => setFormat('md')}
              >
                .md
              </button>
              <button
                type="button"
                className={`segmented-item${format === 'txt' ? ' active' : ''}`}
                onClick={() => setFormat('txt')}
              >
                .txt
              </button>
            </div>
          )}
        </div>

        {error && <p className="setting-error">{error}</p>}
        {done && <p className="share-done">{done}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={props.onClose}>
            닫기
          </button>
          <button type="button" className="btn-primary" disabled={!ready || busy} onClick={share}>
            {busy ? '처리 중…' : '공유'}
          </button>
        </div>
      </div>
    </div>
  )
}
