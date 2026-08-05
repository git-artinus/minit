import type { Meeting } from './types'

export interface MeetingFilter { participant?: string; from?: string; to?: string }
export type SortKey = 'date' | 'title'

export function queryMeetings(
  meetings: Meeting[], filter: MeetingFilter, sortKey: SortKey, dir: 'asc' | 'desc',
): Meeting[] {
  const filtered = meetings.filter((m) => {
    if (filter.participant && !m.participants.includes(filter.participant)) return false
    const day = m.date.slice(0, 10)
    if (filter.from && day < filter.from) return false
    if (filter.to && day > filter.to) return false
    return true
  })
  const sign = dir === 'asc' ? 1 : -1
  return filtered.toSorted((a, b) =>
    sign * (sortKey === 'date' ? a.date.localeCompare(b.date) : a.title.localeCompare(b.title, 'ko')))
}

export function collectParticipants(meetings: Meeting[]): string[] {
  return [...new Set(meetings.flatMap((m) => m.participants))].sort((a, b) => a.localeCompare(b, 'ko'))
}

// 최근 함께한 참석자에 가중치를 매긴다. 최근 recentCount개 회의에서 등장한 "회의 수"를 세므로
// 자주 만나는 사람과 최근에 만난 사람이 함께 올라온다 — 둘을 별도 점수로 섞지 않아도 된다.
// 한 회의에 같은 이름이 중복돼도 1회로 센다(참석자 목록의 중복이 순위를 왜곡하지 않게).
export function participantRecency(meetings: Meeting[], recentCount = 20): Map<string, number> {
  const recent = meetings.toSorted((a, b) => b.date.localeCompare(a.date)).slice(0, recentCount)
  const weight = new Map<string, number>()
  for (const meeting of recent) {
    for (const name of new Set(meeting.participants)) weight.set(name, (weight.get(name) ?? 0) + 1)
  }
  return weight
}

// 가중치 내림차순, 동점이면 이름순. 이름 추출을 주입받아 Slack 멤버(객체)와 게스트(문자열)
// 양쪽에 같은 규칙을 쓴다. 동점을 이름순으로 고정하는 이유는 순서 안정성이다 — 목록을 접어
// 일부만 보여주므로 열 때마다 순서가 달라지면 찾기 어렵다.
export function sortByRecency<T>(
  items: readonly T[], nameOf: (item: T) => string, weight: Map<string, number>,
): T[] {
  return items.toSorted((a, b) => {
    const diff = (weight.get(nameOf(b)) ?? 0) - (weight.get(nameOf(a)) ?? 0)
    return diff !== 0 ? diff : nameOf(a).localeCompare(nameOf(b), 'ko')
  })
}
