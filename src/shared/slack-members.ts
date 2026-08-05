import type { SlackMember, SlackMembers } from './types'

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

// 표시이름 폴백 체인. display_name을 최우선으로 두는 이유는 실측 근거다 — real_name은
// 'Ann' / 'Ann Kim' / '김하나'처럼 표기가 제각각인 반면 display_name은 조직 규칙을 따른다.
// display_name이 비어 있는 계정이 실재하므로 폴백 자체가 필수다.
function displayNameOf(u: SlackApiUser): string | null {
  return firstNonEmpty(u.profile?.display_name, u.profile?.real_name, u.real_name, u.name)
}

// 봇·삭제된 계정·Slackbot은 회의 참석자가 될 수 없다. 실측에서 160명 중 129명이 이 부류였다 —
// 거르지 않으면 목록이 쓸모없어진다.
export function toSlackMembers(raw: SlackApiUser[]): SlackMember[] {
  const out: SlackMember[] = []
  for (const u of raw) {
    if (typeof u.id !== 'string' || u.id === '' || u.id === 'USLACKBOT') continue
    if (u.deleted === true || u.is_bot === true) continue
    const name = displayNameOf(u)
    if (name === null) continue
    out.push({ id: u.id, name })
  }
  return out
}

// 손상된 파일은 throw해 호출부(slack-members-store)가 빈 목록으로 폴백하게 한다 — roster와 동일 관례.
export function parseSlackMembers(raw: string): SlackMembers {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('slack-members: 객체가 아니다')
  const { members, syncedAt } = parsed as Record<string, unknown>
  if (!Array.isArray(members)) throw new Error('slack-members.members: 배열이 아니다')
  members.forEach((m, i) => {
    const item = m as Record<string, unknown> | null
    if (typeof item?.id !== 'string' || typeof item?.name !== 'string') {
      throw new Error(`slack-members.members[${i}]: id·name이 문자열이 아니다`)
    }
  })
  return {
    members: members as SlackMember[],
    syncedAt: typeof syncedAt === 'string' ? syncedAt : ''
  }
}

// 같은 사람이 Slack 그룹과 게스트 그룹에 두 번 뜨는 것을 막는다. participants.json은 건드리지
// 않고 표시 단계에서만 걸러낸다 — Slack 연결을 해제하면 게스트가 원래대로 돌아와야 하고,
// 동기화가 사용자 데이터를 말없이 지우면 안 된다.
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
// 대상으로 해야 한다 — Slack 사용자를 participants.json에 넣으면 게스트 목록에 같은 사람이
// 계속 쌓여 중복이 재생산된다.
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

// 완전 일치할 때만 멘션한다(부분·대소문자 무시 매칭 금지). 표시이름이 중복되면 누구인지
// 확정할 수 없으므로 멘션하지 않고 평문으로 남긴다.
export function findMentionId(name: string, members: SlackMember[]): string | null {
  const target = name.trim()
  const matches = members.filter((m) => m.name === target)
  return matches.length === 1 ? matches[0].id : null
}
