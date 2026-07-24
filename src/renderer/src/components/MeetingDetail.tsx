import { useMemo, useState } from 'react'
import { formatStartTime, formatTimestamp } from '../../../shared/meeting-file'
import { mergeParagraphs } from '../../../shared/transcript'
import { meetingTypeDef } from '../../../shared/meeting-types'
import type { MeetingSection } from '../../../shared/types'
import { useMeetings } from '../state/meetings'

// 사용량 한도 초과일 가능성이 있는 에러 메시지 패턴(Claude CLI가 남기는 문자열 기준) — 실버그
// 대응(v0.4.0 ③b): 재생성 실패를 무반응으로 삼키지 않고 표면화한다.
const LIMIT_ERROR_RE = /limit|usage/i

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

export function MeetingDetail(): React.JSX.Element {
  const { meetings, selected, refresh } = useMeetings()
  const meeting = meetings.find((m) => m.filename === selected)
  const [regenerating, setRegenerating] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)
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
    try {
      await window.minuting.regenerateSummary(meeting.filename)
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
        <h1>{meeting.title}</h1>
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
      <section>
        <h2>요약</h2>
        {meeting.summary
          ? <p>{meeting.summary}</p>
          : (
            <>
              <p className="muted">
                요약이 없습니다. (claude 미설치 또는 요약 실패){' '}
                <button type="button" className="btn-ghost" disabled={regenerating} onClick={regenerateSummary}>
                  {regenerating ? '재생성 중…' : '요약 재생성'}
                </button>
              </p>
              {regenError && (
                <p className="setting-error">
                  요약 생성 실패: {regenError}
                  {LIMIT_ERROR_RE.test(regenError) && ' — Claude 사용량 한도일 수 있습니다 — 잠시 후 다시 시도하세요'}
                </p>
              )}
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
    </article>
  )
}
