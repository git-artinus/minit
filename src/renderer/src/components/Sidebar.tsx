import { useEffect, useMemo, useState } from 'react'
import { collectParticipants, queryMeetings, type MeetingFilter, type SortKey } from '../../../shared/meeting-query'
import { formatStartTime } from '../../../shared/meeting-file'
import type { PipelineStage, PipelineStatus, Roster } from '../../../shared/types'
import { useMeetings } from '../state/meetings'
import { useSetup } from '../state/setup'
import { BrandLockup } from './BrandLogo'
import { RecordingBar } from './RecordingBar'
import { StartMeetingModal } from './StartMeetingModal'

export function Sidebar({
  onOpenSettings
}: {
  onOpenSettings: () => void
}): React.JSX.Element {
  const { meetings, selected, view, pipelines, select, startMeeting, stopMeeting, retryPipeline } = useMeetings()
  const { ready } = useSetup()
  const [modalOpen, setModalOpen] = useState(false)
  const [filter, setFilter] = useState<MeetingFilter>({})
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  // undefined = 로딩 중, null = 명단 파일 없음(자유입력 폴백)
  const [roster, setRoster] = useState<Roster | null | undefined>(undefined)

  useEffect(() => {
    window.minuting
      .getRoster()
      .then((r) => setRoster(r as Roster | null))
      .catch(() => setRoster(null))
  }, [])

  const visible = useMemo(() => queryMeetings(meetings, filter, sortKey, dir), [meetings, filter, sortKey, dir])
  const participants = useMemo(() => collectParticipants(meetings), [meetings])
  // 필터 드롭다운 목록 — 개인 로스터(있으면)와 실제 회의록 참석자(수동 입력·게스트 포함)를
  // 합쳐 단일 목록으로 보여준다(팀 optgroup 구조는 폐기, v0.4.0 ③a).
  const filterNames = useMemo(() => {
    const hasRoster = !!roster && roster.participants.length > 0
    if (!hasRoster) return participants
    return [...new Set([...roster!.participants, ...participants])].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [roster, participants])
  const running = Object.values(pipelines).filter(
    (p) => p.stage !== 'done' || p.error?.stage === 'transcribing' || p.error?.stage === 'saving'
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <span className="wordmark">
          <BrandLockup height={18} />
        </span>
        <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="설정">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
            <path
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
        </button>
      </div>
      <div className="sidebar-hero">
        {view.kind === 'recording' ? (
          <RecordingBar startedAtMs={Date.parse(view.meta.date)} onStop={stopMeeting} />
        ) : (
          <button
            className="btn-primary btn-hero"
            disabled={!ready}
            title={ready ? undefined : '음성 인식 모델 다운로드 후 사용할 수 있습니다'}
            onClick={() => setModalOpen(true)}
          >
            회의 시작
          </button>
        )}
      </div>
      <div className="filters">
        <div className="filter-field">
          <label className="filter-label" htmlFor="filter-participant">
            참석자
          </label>
          <select
            id="filter-participant"
            value={filter.participant ?? ''}
            onChange={(e) => setFilter({ ...filter, participant: e.target.value || undefined })}
          >
            <option value="">전체</option>
            {filterNames.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label" htmlFor="filter-from">
            기간
          </label>
          <div className="filter-range">
            <input
              id="filter-from"
              type="date"
              value={filter.from ?? ''}
              onChange={(e) => setFilter({ ...filter, from: e.target.value || undefined })}
            />
            <span className="range-sep">–</span>
            <input
              type="date"
              value={filter.to ?? ''}
              onChange={(e) => setFilter({ ...filter, to: e.target.value || undefined })}
              aria-label="종료일"
            />
          </div>
        </div>
        <div className="filter-field">
          <label className="filter-label" htmlFor="filter-sort">
            정렬
          </label>
          <select
            id="filter-sort"
            value={`${sortKey}:${dir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(':') as [SortKey, 'asc' | 'desc']
              setSortKey(k)
              setDir(d)
            }}
          >
            <option value="date:desc">최신순</option>
            <option value="date:asc">오래된순</option>
            <option value="title:asc">제목순</option>
          </select>
        </div>
        {(filter.participant || filter.from || filter.to) && (
          <button className="filter-clear" onClick={() => setFilter({})}>
            초기화
          </button>
        )}
      </div>
      <div className="meeting-list">
        {running.length === 0 && visible.length === 0 && (
          <div className="meeting-empty">
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
            <h3>회의록이 없습니다</h3>
            <p>&apos;회의 시작&apos;으로 첫 회의록을 만들어 보세요.</p>
          </div>
        )}
        {running.map((p) => (
          <PipelineCard key={p.recordingId} status={p} onRetry={retryPipeline} />
        ))}
        {visible.map((m) => (
          <div
            key={m.filename}
            className={`meeting-card${m.filename === selected ? ' selected' : ''}`}
            onClick={() => select(m.filename)}
          >
            <h3>{m.title}</h3>
            <div className="date">
              {m.date.slice(0, 10)} {formatStartTime(m.date)} · {m.durationMin}분
              {m.participants.length > 0 && <> · {m.participants.length}명</>}
            </div>
            <div className="excerpt">{m.summary || m.segments[0]?.text || ''}</div>
          </div>
        ))}
      </div>
      {modalOpen && (
        <StartMeetingModal
          knownParticipants={participants}
          onClose={() => setModalOpen(false)}
          onStart={(meta) => {
            setModalOpen(false)
            startMeeting(meta)
          }}
        />
      )}
    </aside>
  )
}

function isFailed(p: PipelineStatus): boolean {
  return p.error?.stage === 'transcribing' || p.error?.stage === 'saving'
}

function stageLabel(p: PipelineStatus): string {
  if (p.error?.stage === 'transcribing') return '⚠ 전사 실패'
  if (p.error?.stage === 'saving') return '⚠ 저장 실패'
  return { transcribing: '전사 중…', summarizing: '요약 중…', saving: '저장 중…' }[p.stage] ?? ''
}

// 진행 카드(v0.4.0 ③b) — 실패 상태는 기존 ⚠ 카드+재시도를 그대로 유지하고, 진행 중일 때만
// 스피너 + 3단계(전사 → 요약 → 저장) 표시로 개편한다. STEP_ORDER의 인덱스로 완료/진행/대기를 가른다.
const STEP_ORDER: PipelineStage[] = ['transcribing', 'summarizing', 'saving', 'done']
const STEPS: { key: PipelineStage; label: string }[] = [
  { key: 'transcribing', label: '전사' },
  { key: 'summarizing', label: '요약' },
  { key: 'saving', label: '저장' }
]

function PipelineCard({
  status,
  onRetry
}: {
  status: PipelineStatus
  onRetry: (recordingId: string) => void
}): React.JSX.Element {
  if (isFailed(status)) {
    return (
      <div className="meeting-card">
        <h3>{stageLabel(status)}</h3>
        <button type="button" className="btn-ghost" onClick={() => onRetry(status.recordingId)}>
          재시도
        </button>
      </div>
    )
  }
  const currentIdx = STEP_ORDER.indexOf(status.stage)
  return (
    <div className="meeting-card pipeline-card" role="status" aria-label={stageLabel(status)}>
      <div className="pipeline-spinner" aria-hidden="true" />
      <div className="pipeline-steps">
        {STEPS.map((s) => {
          const stepIdx = STEP_ORDER.indexOf(s.key)
          const state = stepIdx < currentIdx ? 'done' : stepIdx === currentIdx ? 'active' : 'pending'
          return (
            <div key={s.key} className={`pipeline-step pipeline-step-${state}`}>
              <span className="pipeline-step-dot">{state === 'done' ? '✓' : stepIdx + 1}</span>
              <span className="pipeline-step-label">{s.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
