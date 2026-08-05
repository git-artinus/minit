import type { SlackMember, SlackMembers, SlackSyncError, SlackSyncErrorReason } from './types'

// users.list 응답 항목 중 이 기능이 쓰는 필드만 좁혀 받는다.
export interface SlackApiUser {
  id?: unknown
  name?: unknown
  real_name?: unknown
  deleted?: unknown
  is_bot?: unknown
  profile?: { display_name?: unknown; real_name?: unknown }
}

function firstNonEmpty(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim()
  }
  return null
}

// 표시이름 폴백 체인. display_name을 최우선으로 두는 이유는 real_name에 표기 규칙이 없기
// 때문이다 — 영문 약칭·영문 풀네임·한글 이름이 섞여 들어오는 반면 display_name은 조직이 정한
// 규칙을 따르는 경향이 있다. display_name이 비어 있는 계정도 실재하므로 폴백 자체가 필수다.
function displayNameOf(u: SlackApiUser): string | null {
  return firstNonEmpty(u.profile?.display_name, u.profile?.real_name, u.real_name, u.name)
}

// users.list는 봇·삭제된 계정까지 전부 반환하므로 걸러내지 않으면 목록이 쓸모없어진다.
// 표본: 사내 워크스페이스 1곳에서 160명 중 실제 사람은 31명뿐이었다(2026-08-04).
export function toSlackMembers(raw: SlackApiUser[]): SlackMember[] {
  const out: SlackMember[] = []
  for (const u of raw) {
    if (typeof u.id !== 'string' || u.id === '' || u.id === 'USLACKBOT') continue
    if (u.deleted === true || u.is_bot === true) continue
    const name = displayNameOf(u)
    if (name === null) continue
    out.push({ id: u.id, name })
  }
  // 이름순 정렬 — users.list 반환 순서는 의미가 없고 호출마다 달라질 수 있다. 목록을 접어서
  // 일부만 보여주므로 순서가 안정적이어야 하고, 로스터(dedupeAndSort)와도 기준을 맞춘다.
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

const SYNC_ERROR_REASONS: SlackSyncErrorReason[] = ['no_token', 'missing_scope', 'auth', 'network', 'unknown']

function parseSyncError(value: unknown): SlackSyncError | null {
  if (typeof value !== 'object' || value === null) return null
  const { reason, detail } = value as Record<string, unknown>
  if (typeof reason !== 'string' || !SYNC_ERROR_REASONS.includes(reason as SlackSyncErrorReason)) return null
  return { reason: reason as SlackSyncErrorReason, detail: typeof detail === 'string' ? detail : '' }
}

// 손상된 파일은 throw해 호출부(slack-members-store)가 빈 목록으로 폴백하게 한다 — roster와 동일 관례.
// 항목 검증 수준을 toSlackMembers와 맞춘다: 이 앱은 사용자가 ~/.minit/*.json을 직접 편집하는 것을
// 전제하는 제품이라(로스터 Import), 우리가 쓴 파일만 읽는다는 가정이 성립하지 않는다. 빈 id는
// React key 중복을, 빈 name은 라벨 없는 칩을 만든다.
export function parseSlackMembers(raw: string): SlackMembers {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('slack-members: 객체가 아니다')
  const { members, syncedAt, lastError } = parsed as Record<string, unknown>
  if (!Array.isArray(members)) throw new Error('slack-members.members: 배열이 아니다')
  members.forEach((m, i) => {
    const item = m as Record<string, unknown> | null
    if (typeof item?.id !== 'string' || item.id.trim() === '') {
      throw new Error(`slack-members.members[${i}]: id가 비어 있다`)
    }
    if (typeof item?.name !== 'string' || item.name.trim() === '') {
      throw new Error(`slack-members.members[${i}]: name이 비어 있다`)
    }
  })
  // 빈 문자열·파싱 불가 날짜는 "동기화한 적 없음"으로 본다(구버전 파일 호환).
  const syncedAtOk =
    typeof syncedAt === 'string' && syncedAt !== '' && !Number.isNaN(Date.parse(syncedAt))
  return {
    members: members as SlackMember[],
    syncedAt: syncedAtOk ? (syncedAt as string) : null,
    lastError: parseSyncError(lastError)
  }
}

// Slack API 에러 메시지를 사유로 분류한다. 렌더러가 문자열을 되짚지 않도록 여기서 한 번만 한다.
export function classifySyncError(message: string): SlackSyncError {
  const reason: SlackSyncErrorReason = message.includes('missing_scope')
    ? 'missing_scope'
    : /invalid_auth|account_inactive|token_revoked|not_authed/.test(message)
      ? 'auth'
      : /응답 실패|fetch|network|timeout|시간이 초과|ENOTFOUND|ECONN/i.test(message)
        ? 'network'
        : 'unknown'
  return { reason, detail: message }
}

// 같은 사람이 Slack 그룹과 게스트 그룹에 두 번 뜨는 것을 막는다. participants.json은 건드리지
// 않고 표시 단계에서만 걸러낸다 — Slack 연결을 해제하면 게스트가 원래대로 돌아와야 하고,
// 동기화가 사용자 데이터를 말없이 지우면 안 된다.
//
// 완전 일치 기준이다(로스터의 대소문자 무시 관례와 다르다) — 표기가 다르면 양쪽에 뜬다.
// 멘션 매칭(findMentionId)과 기준을 맞춰야 "칩에서 숨겨졌는데 멘션은 안 되는" 어긋남이 없다.
export function visibleGuests(guests: string[], members: SlackMember[]): string[] {
  const slackNames = new Set(members.map((m) => m.name))
  return guests.filter((g) => !slackNames.has(g))
}

// 멘션 대상을 이 회의의 참석자로 좁힌다. 요약 모델이 회의에 없던 이름을 뽑았을 때 무관한
// 사람에게 알림이 가는 것을 막는다.
export function membersInMeeting(participants: string[], members: SlackMember[]): SlackMember[] {
  const selected = new Set(participants)
  return members.filter((m) => selected.has(m.name))
}

// 회의 시작 시 선택된 참석자를 Slack 사용자와 게스트로 나눈다. 로스터 자동 등록은 게스트만
// 대상으로 해야 한다 — Slack 사용자를 participants.json에 넣으면 워크스페이스 종속 이름이
// 개인 명단에 영구히 남고(Export에도 따라간다), 동기화가 복구돼도 지워지지 않는다.
export function splitParticipants(
  selected: string[],
  members: SlackMember[]
): { slack: string[]; guests: string[] } {
  const slackNames = new Set(membersInMeeting(selected, members).map((m) => m.name))
  return {
    slack: selected.filter((n) => slackNames.has(n)),
    guests: selected.filter((n) => !slackNames.has(n))
  }
}

// 접힌 목록에 보여줄 멤버를 고른다. 앞에서부터 limit명을 취하되, 잘린 구간에 이미 선택된
// 사람이 있으면 함께 남긴다 — 고른 참석자가 접힘 뒤로 숨으면 무엇을 선택했는지 확인할 수 없다.
// 정렬 순서는 유지한다(선택된 것을 앞으로 끌어올리면 누를 때마다 목록이 뒤바뀐다).
export function collapseMembers(
  members: SlackMember[],
  selected: ReadonlySet<string>,
  limit: number
): SlackMember[] {
  if (members.length <= limit) return members
  const head = members.slice(0, limit)
  const selectedBeyond = members.slice(limit).filter((m) => selected.has(m.name))
  return [...head, ...selectedBeyond]
}

// 완전 일치할 때만 멘션한다(부분·대소문자 무시 매칭 금지). 표시이름이 중복되면 누구인지
// 확정할 수 없으므로 멘션하지 않고 평문으로 남긴다.
export function findMentionId(name: string, members: SlackMember[]): string | null {
  const target = name.trim()
  const matches = members.filter((m) => m.name === target)
  return matches.length === 1 ? matches[0].id : null
}
