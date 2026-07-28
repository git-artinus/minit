import { useMemo, useState } from 'react'
import { formatStartTime, formatTimestamp } from '../../../shared/meeting-file'
import { mergeParagraphs } from '../../../shared/transcript'
import { meetingTypeDef } from '../../../shared/meeting-types'
import type { MeetingSection, SummaryFailure } from '../../../shared/types'
import { useMeetings } from '../state/meetings'
import { summaryFailureView } from '../state/summary-failure'
import { ShareMeetingModal } from './ShareMeetingModal'

// 섹션 kind별 본문 렌더 — actions는 담당/기한 badge, list는 불릿, text는 문단.
function SectionBody({ section }: { section: MeetingSection }): React.JSX.Element {
  if (section.kind === 'actions') {
    return section.items.length === 0
      ? <p className="muted">항목이 없습니다.</p>
      : (
        <ul>
          {section.items.map((a, i) => (
            <li key={i}>
              {a.text}
              {a.assignee && <span className="badge">담당: {a.assignee}</span>}
              {a.due && <span className="badge">기한: {a.due}</span>}
            </li>
          ))}
        </ul>
      )
  }
  if (section.kind === 'list') {
    return section.items.length === 0
      ? <p className="muted">항목이 없습니다.</p>
      : <ul>{section.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
  }
  return section.text.trim() === '' ? <p className="muted">내용이 없습니다.</p> : <p>{section.text}</p>
}

// detail(claude가 실제로 남긴 원문)은 사유와 무관하게 항상 노출한다 — 분류가 빗나가도
// 사용자가 진짜 원인을 볼 수 있어야 한다. 사유를 못 가리는 것보다 나쁜 건 틀린 사유만 보이는 것이다.
function SummaryFailureNotice({ failure }: { failure: SummaryFailure }): React.JSX.Element {
  const view = summaryFailureView(failure)
  return (
    <div className="summary-failure">
      <p className="summary-failure-title">{view.title}</p>
      <p className="setting-desc">{view.hint}</p>
      {failure.detail.trim() !== '' && <div className="summary-failure-detail">{failure.detail}</div>}
    </div>
  )
}

export function MeetingDetail(): React.JSX.Element {
  const { meetings, selected, refresh } = useMeetings()
  const meeting = meetings.find((m) => m.filename === selected)
  const [regenerating, setRegenerating] = useState(false)
  // 분류된 실패(claude 원인)와 예상 밖 예외(파일·git)를 구분해 담는다.
  const [regenFailure, setRegenFailure] = useState<SummaryFailure | null>(null)
  const [regenError, setRegenError] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  // 기존(v0.5.0 이전) 회의록은 endMs가 없어 start→start 근사 gap으로 병합된다. 원본 파일은 수정하지 않는다.
  const paragraphs = useMemo(() => mergeParagraphs(meeting?.segments ?? []), [meeting?.segments])
  if (!meeting) {
    return (
      <div className="meeting-empty empty">
        <div className="empty-glyph">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
            <path
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
            />
            <path stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M14 3v4h4M9 12h6M9 15.5h6M9 8.5h2" />
          </svg>
        </div>
        <h3>좌측에서 회의록을 선택하세요</h3>
        <p>목록에서 회의록을 클릭하면 요약과 트랜스크립트를 볼 수 있습니다.</p>
      </div>
    )
  }

  const regenerateSummary = async (): Promise<void> => {
    setRegenerating(true)
    setRegenError(null)
    setRegenFailure(null)
    try {
      const result = await window.minuting.regenerateSummary(meeting.filename)
      // 반환값을 버리면 실패가 조용히 사라진다(예외가 아니라 값이므로 catch가 잡지 않는다).
      if (!result.ok) {
        setRegenFailure(result.failure)
        return
      }
      await refresh()
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : String(e))
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <article>
      <header className="detail-header">
        <div className="detail-header-top">
          <h1>{meeting.title}</h1>
          <button type="button" className="btn-ghost share-btn" onClick={() => setShareOpen(true)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
              <path
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3v12M12 3 8 7M12 3l4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"
              />
            </svg>
            공유
          </button>
        </div>
        <p className="date">
          {meeting.date.slice(0, 10)} {formatStartTime(meeting.date)} · {meeting.durationMin}분 ·{' '}
          {meetingTypeDef(meeting.meetingType).label}
        </p>
        {meeting.recorder && <p className="date">기록: {meeting.recorder}</p>}
        {meeting.participants.length > 0 && (
          <div className="participant-chips">
            {meeting.participants.map((p) => (
              <span key={p} className="participant-chip">{p}</span>
            ))}
          </div>
        )}
      </header>
      {meeting.transcriptFlagged && (
        <div className="transcript-warning" role="status">
          일부 구간이 인식 오류로 반복되었을 수 있습니다. 해당 부분의 트랜스크립트·요약은 정확하지 않을 수 있습니다.
        </div>
      )}
      <section>
        <h2>요약</h2>
        {meeting.summary
          ? <p>{meeting.summary}</p>
          : (
            <>
              <p className="muted">
                요약이 없습니다. 아래 버튼을 누르면 원인을 확인하고 다시 생성합니다.{' '}
                <button
                  type="button"
                  className="btn-ghost"
                  // 미설치처럼 앱 밖에서 조치해야 하는 사유는 재시도해도 같은 결과다.
                  disabled={regenerating || (regenFailure !== null && !summaryFailureView(regenFailure).canRetry)}
                  onClick={regenerateSummary}
                >
                  {regenerating ? '재생성 중…' : '요약 재생성'}
                </button>
              </p>
              {regenFailure && <SummaryFailureNotice failure={regenFailure} />}
              {regenError && <p className="setting-error">요약 생성 실패: {regenError}</p>}
            </>
          )}
      </section>
      {meeting.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          <SectionBody section={s} />
        </section>
      ))}
      <section>
        <h2>트랜스크립트</h2>
        <div className="transcript">
          {paragraphs.map((s, i) => (
            <p key={i}><span className="ts">{formatTimestamp(s.startMs)}</span> {s.text}</p>
          ))}
        </div>
      </section>
      {shareOpen && <ShareMeetingModal meeting={meeting} onClose={() => setShareOpen(false)} />}
    </article>
  )
}
