import { describe, expect, test } from 'vitest'
import {
  collectParticipants,
  participantRecency,
  queryMeetings,
  sortByRecency
} from '../../src/shared/meeting-query'
import type { Meeting } from '../../src/shared/types'

function m(over: Partial<Meeting>): Meeting {
  return {
    filename: 'f.md', title: '회의', date: '2026-07-20T10:00:00+09:00',
    durationMin: 30, participants: [], meetingType: 'general', summary: '', sections: [], segments: [],
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

describe('participantRecency', () => {
  test('최근 회의에 등장한 횟수를 센다', () => {
    const weight = participantRecency(meetings)
    expect(weight.get('조엘')).toBe(2)
    expect(weight.get('케빈')).toBe(2)
  })

  test('recentCount를 넘는 오래된 회의는 세지 않는다', () => {
    // 최근 1개(b.md, 07-20)만 본다 — 거기 없는 사람은 가중치가 없다.
    const weight = participantRecency(meetings, 1)
    expect(weight.get('조엘')).toBe(1)
    expect(weight.get('케빈')).toBe(1)
    expect(weight.size).toBe(2)
  })

  test('회의가 없으면 빈 맵이다', () => {
    expect(participantRecency([]).size).toBe(0)
  })

  test('한 회의에 같은 이름이 두 번 있어도 회의 단위로 센다', () => {
    const weight = participantRecency([m({ participants: ['조엘', '조엘'] })])
    expect(weight.get('조엘')).toBe(1)
  })
})

describe('sortByRecency', () => {
  const weight = new Map([
    ['케빈', 5],
    ['조엘', 2]
  ])

  test('가중치가 높은 사람이 앞에 온다', () => {
    expect(sortByRecency(['조엘', '케빈'], (n) => n, weight)).toEqual(['케빈', '조엘'])
  })

  test('가중치가 없는 사람은 뒤로 간다', () => {
    expect(sortByRecency(['신입', '조엘'], (n) => n, weight)).toEqual(['조엘', '신입'])
  })

  test('동점이면 이름순이다 — 순서가 흔들리지 않아야 한다', () => {
    const tie = new Map([
      ['가나', 1],
      ['다라', 1]
    ])
    expect(sortByRecency(['다라', '가나'], (n) => n, tie)).toEqual(['가나', '다라'])
  })

  test('객체도 이름 추출 함수로 정렬한다', () => {
    const members = [
      { id: 'U1', name: '조엘' },
      { id: 'U2', name: '케빈' }
    ]
    expect(sortByRecency(members, (x) => x.name, weight).map((x) => x.id)).toEqual(['U2', 'U1'])
  })

  test('원본 배열을 변형하지 않는다', () => {
    const input = ['조엘', '케빈']
    sortByRecency(input, (n) => n, weight)
    expect(input).toEqual(['조엘', '케빈'])
  })
})
