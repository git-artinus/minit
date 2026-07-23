import { describe, expect, test } from 'vitest'
import { collectParticipants, queryMeetings } from '../../src/shared/meeting-query'
import type { Meeting } from '../../src/shared/types'

function m(over: Partial<Meeting>): Meeting {
  return {
    filename: 'f.md', title: '회의', date: '2026-07-20T10:00:00+09:00',
    durationMin: 30, participants: [], summary: '', actionItems: [], segments: [],
    ...over,
  }
}

const meetings = [
  m({ filename: 'a.md', title: '기획 리뷰', date: '2026-07-18T10:00:00+09:00', participants: ['조엘'] }),
  m({ filename: 'b.md', title: '주간 스탠드업', date: '2026-07-20T10:00:00+09:00', participants: ['조엘', '케빈'] }),
  m({ filename: 'c.md', title: '아키텍처 논의', date: '2026-07-19T15:00:00+09:00', participants: ['케빈'] }),
]

describe('queryMeetings', () => {
  test('기본: 날짜 내림차순', () => {
    expect(queryMeetings(meetings, {}, 'date', 'desc').map((x) => x.filename))
      .toEqual(['b.md', 'c.md', 'a.md'])
  })
  test('참석자 필터', () => {
    expect(queryMeetings(meetings, { participant: '케빈' }, 'date', 'desc').map((x) => x.filename))
      .toEqual(['b.md', 'c.md'])
  })
  test('날짜 범위 필터 (경계 포함)', () => {
    expect(queryMeetings(meetings, { from: '2026-07-19', to: '2026-07-19' }, 'date', 'desc')
      .map((x) => x.filename)).toEqual(['c.md'])
  })
  test('제목 오름차순 정렬', () => {
    expect(queryMeetings(meetings, {}, 'title', 'asc').map((x) => x.title))
      .toEqual(['기획 리뷰', '아키텍처 논의', '주간 스탠드업'])
  })
})

test('collectParticipants: 중복 제거·가나다순', () => {
  expect(collectParticipants(meetings)).toEqual(['조엘', '케빈'].sort((a, b) => a.localeCompare(b, 'ko')))
})
