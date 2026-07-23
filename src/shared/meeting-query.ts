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
