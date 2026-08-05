import { useEffect, useState } from 'react'
import type {
  MeetingMeta,
  Roster,
  SlackChannel,
  AppSettings,
  SlackMember,
  SlackTokenState
} from '../../../shared/types'
import { defaultMeetingTitle, localIsoNow } from '../../../shared/meeting-file'
import { resolveMemberName } from '../../../shared/roster'
import { splitParticipants, visibleGuests } from '../../../shared/slack-members'
import { DEFAULT_MEETING_TYPE, MEETING_TYPES } from '../../../shared/meeting-types'
import { SlackChannelSelect } from './SlackChannelSelect'
import {
  CHANNEL_DEFAULT,
  CHANNEL_NONE,
  channelOverrideToValue,
  channelValueToOverride,
  defaultChannelOptionLabel
} from './start-meeting-channel'

export function StartMeetingModal(props: {
  knownParticipants: string[]
  onStart: (meta: MeetingMeta) => void
  onClose: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([]) // roster 없으면 참석자 전체, 있으면 게스트만
  const [draft, setDraft] = useState('') // 태그 입력칸에 아직 확정되지 않은 텍스트
  // undefined = 로딩 중, null = 명단 파일 없음(자유입력 폴백)
  const [roster, setRoster] = useState<Roster | null | undefined>(undefined)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [meetingType, setMeetingType] = useState(DEFAULT_MEETING_TYPE)

  // Slack 채널 override(#2) — undefined=설정 기본값 사용 / null=발송 안 함 / string=이 채널로.
  const [channelOverride, setChannelOverride] = useState<string | null | undefined>(undefined)
  const [slackDefault, setSlackDefault] = useState<{ id: string | null; name: string | null; autoSend: boolean }>({
    id: null,
    name: null,
    autoSend: false
  })
  const [slackTokenSaved, setSlackTokenSaved] = useState(false)
  const [slackChannels, setSlackChannels] = useState<SlackChannel[] | null>(null)
  // null = 아직 못 읽음(로딩 중이거나 실패). 빈 배열(=Slack 멤버가 실제로 0명)과 반드시
  // 구분한다 — 못 읽은 상태를 0명으로 취급하면 start()에서 Slack 사용자가 게스트로 분류돼
  // participants.json에 영구히 쌓인다.
  const [slackMembers, setSlackMembers] = useState<SlackMember[] | null>(null)

  useEffect(() => {
    window.minuting
      .getRoster()
      .then((r) => setRoster(r as Roster | null))
      .catch(() => setRoster(null))
  }, [])

  // 저장된 목록만 읽는다 — 여기서 동기화하면 모달이 늦게 뜨고 고르는 도중 목록이 흔들린다.
  // 실패 시 null을 유지한다(빈 배열로 떨어뜨리지 않는다 — 위 상태 선언 참조).
  useEffect(() => {
    window.minuting
      .getSlackMembers()
      .then((s) => setSlackMembers(s.members))
      .catch((e) => console.error('[slack] 멤버 목록을 불러오지 못했습니다:', e))
  }, [])

  useEffect(() => {
    window.minuting
      .getSettings()
      .then((s: AppSettings) =>
        setSlackDefault({ id: s.slackChannelId, name: s.slackChannelName, autoSend: s.slackAutoSend })
      )
      .catch(() => {})
    window.minuting
      .getSlackTokenState()
      .then((t: SlackTokenState) => setSlackTokenSaved(t.saved))
      .catch(() => {})
  }, [])

  // 드롭다운을 처음 열 때(focus) 목록을 지연 조회한다(설정 화면과 동일 관례).
  const loadChannels = (): void => {
    if (slackChannels) return
    window.minuting.listSlackChannels().then(setSlackChannels).catch(() => {})
  }

  // 로스터 파일이 있어도 참석자가 비어 있으면(신규 사용자 등) 자유 입력 폴백을 유지한다.
  const hasRoster = !!roster && roster.participants.length > 0
  // 렌더에서는 미로드(null)를 빈 목록과 같이 취급해도 안전하다 — 칩이 안 뜰 뿐이다.
  // 구분이 필요한 곳은 start()의 로스터 자동 등록뿐이다.
  const slackChips = slackMembers ?? []

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // 로스터 선택 칩과도 대소문자 무시로 중복 방지
  const isDuplicateTag = (name: string): boolean => {
    const lower = name.toLowerCase()
    return (
      [...selected].some((s) => s.toLowerCase() === lower) ||
      tags.some((t) => t.toLowerCase() === lower)
    )
  }

  const addTag = (raw: string): void => {
    const name = raw.trim()
    if (!name || isDuplicateTag(name)) return
    setTags((prev) => [...prev, name])
  }

  const removeTag = (name: string): void => {
    setTags((prev) => prev.filter((t) => t !== name))
  }

  // 쉼표 입력 순간(타이핑·붙여넣기 모두) 콤마 앞부분을 칩으로 확정하고 나머지만 입력칸에 남긴다.
  const handleDraftChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value
    if (value.includes(',')) {
      const parts = value.split(',')
      parts.slice(0, -1).forEach(addTag)
      setDraft(parts[parts.length - 1])
    } else {
      setDraft(value)
    }
  }

  const handleDraftKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag(draft)
      setDraft('')
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1))
    }
  }

  // blur 시 입력하다 만 이름을 유실하지 않도록 자동으로 칩 확정
  const handleDraftBlur = (): void => {
    if (draft.trim()) {
      addTag(draft)
      setDraft('')
    }
  }

  const start = (): void => {
    const now = new Date()
    const guestsResolved = tags.map((g) => resolveMemberName(roster ?? null, g))
    const finalParticipants = [...new Set([...selected, ...guestsResolved])]
    props.onStart({
      title: title.trim() || defaultMeetingTitle(now),
      date: localIsoNow(now),
      durationMin: 0, // 종료 시 갱신
      participants: finalParticipants,
      slackChannelId: channelOverride,
      meetingType
    })
    // 자동 등록(v0.4.0 ③a) — 로스터에 없는 이름을 등록한다. 실패해도 회의 시작 자체는
    // 이미 onStart로 진행되었으므로 격리한다(회귀 없이 조용히 무시).
    // 멤버 목록을 못 읽었으면(null) 아무것도 등록하지 않는다 — 그 상태에서 등록하면 Slack
    // 사용자가 게스트로 잘못 분류돼 개인 명단에 남고, 동기화가 복구돼도 지워지지 않는다.
    if (slackMembers !== null) {
      const { guests } = splitParticipants(finalParticipants, slackMembers)
      window.minuting.addRosterParticipants(guests).catch(() => {})
    }
  }

  // 게스트/참석자 태그 입력 — 로스터 있음/없음 두 코드패스에서 동일하게 재사용
  const tagInput = (
    <div className="tag-input">
      <div className="tag-input-chips">
        {tags.map((name) => (
          <span key={name} className="chip tag-chip">
            {name}
            <button
              type="button"
              className="tag-chip-remove"
              onClick={() => removeTag(name)}
              aria-label={`${name} 제거`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="tag-input-field"
          placeholder="이름 입력 후 Enter"
          list={hasRoster ? undefined : 'participants'}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleDraftKeyDown}
          onBlur={handleDraftBlur}
        />
      </div>
      <p className="env-desc">처음 입력한 이름은 자동으로 참석자 목록에 저장됩니다.</p>
      {!hasRoster && (
        <datalist id="participants">
          {props.knownParticipants.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      )}
    </div>
  )
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      {/* 로딩↔폴백 전환 시 폭이 360↔420으로 튀지 않도록 로스터 모드 기준 폭으로 고정 */}
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>회의 시작</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="닫기">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <input
          placeholder="회의 제목 (비우면 자동)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <div className="chip-group">
          <div className="chip-group-label">회의 유형</div>
          <select value={meetingType} onChange={(e) => setMeetingType(e.target.value)}>
            {MEETING_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        {hasRoster || slackChips.length > 0 ? (
          <>
            {slackChips.length > 0 && (
              <div className="chip-group">
                <div className="chip-group-label">Slack</div>
                <div className="chip-group-body">
                  {slackChips.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`chip${selected.has(m.name) ? ' selected' : ''}`}
                      onClick={() => toggle(m.name)}
                    >
                      <span aria-hidden="true">🔹 </span>
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="chip-group">
              <div className="chip-group-label">게스트</div>
              {hasRoster && (
                <div className="chip-group-body">                  {visibleGuests(roster!.participants, slackChips).map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`chip${selected.has(name) ? ' selected' : ''}`}
                      onClick={() => toggle(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              {tagInput}
            </div>
          </>
        ) : roster !== undefined ? (
          tagInput
        ) : (
          <p className="env-desc">명단 불러오는 중…</p>
        )}
        {slackTokenSaved && (
          <div className="chip-group">
            <div className="chip-group-label">요약 자동 발송</div>
            <SlackChannelSelect
              channels={slackChannels}
              value={channelOverrideToValue(channelOverride)}
              onFocus={loadChannels}
              onChange={(value) => setChannelOverride(channelValueToOverride(value))}
              leading={
                <>
                  <option value={CHANNEL_DEFAULT}>
                    {defaultChannelOptionLabel(slackDefault.autoSend, slackDefault.name)}
                  </option>
                  <option value={CHANNEL_NONE}>(발송 안 함)</option>
                </>
              }
            />
          </div>
        )}
        <button className="btn-primary" onClick={start}>
          녹음 시작
        </button>
      </div>
    </div>
  )
}
