import { describe, expect, test } from 'vitest'
import {
  defaultMeetingTitle, formatStartTime, formatTimestamp, isValidMeetingFilename, localIsoNow, meetingFilename, parseMeeting,
  serializeMeeting,
} from '../../src/shared/meeting-file'

const meeting = {
  meetingType: 'general',
  title: '주간 스탠드업',
  date: '2026-07-20T10:30:00+09:00',
  durationMin: 32,
  participants: ['조엘', '케빈'],
  summary: '스프린트 목표를 정리했다.',
  sections: [
    {
      heading: '액션아이템',
      kind: 'actions' as const,
      items: [{ text: 'API 명세 초안 작성', assignee: '조엘' }],
    },
  ],
  segments: [
    { startMs: 12_000, text: '오늘 스프린트 목표부터 정리하겠습니다.' },
    { startMs: 45_000, text: '지난주 이슈 공유드립니다.' },
  ],
}

describe('meetingFilename', () => {
  test('날짜와 한글 제목 슬러그로 파일명을 만든다', () => {
    expect(meetingFilename('주간 스탠드업', new Date('2026-07-20T10:30:00+09:00')))
      .toBe('2026-07-20-주간-스탠드업.md')
  })
  test('파일명에 쓸 수 없는 문자는 제거한다', () => {
    expect(meetingFilename('회고: A/B안?', new Date('2026-07-20T10:30:00+09:00')))
      .toBe('2026-07-20-회고-AB안.md')
  })
})

describe('formatTimestamp', () => {
  test('밀리초를 [HH:MM:SS]로 변환한다', () => {
    expect(formatTimestamp(12_000)).toBe('[00:00:12]')
    expect(formatTimestamp(3_725_000)).toBe('[01:02:05]')
  })
})

describe('localIsoNow', () => {
  test('로컬 타임존 오프셋을 포함한 ISO8601 문자열 형식을 따른다', () => {
    const result = localIsoNow(new Date(2026, 6, 20, 10, 30, 0))
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })
  test('고정된 Date로부터 해당 Date 기준 로컬 오프셋 문자열을 만든다 (TZ 무관 검증)', () => {
    const fixed = new Date(2026, 6, 20, 10, 30, 0)
    const offsetMin = -fixed.getTimezoneOffset()
    const sign = offsetMin >= 0 ? '+' : '-'
    const abs = Math.abs(offsetMin)
    const offH = String(Math.floor(abs / 60)).padStart(2, '0')
    const offM = String(abs % 60).padStart(2, '0')
    expect(localIsoNow(fixed)).toBe(`2026-07-20T10:30:00${sign}${offH}:${offM}`)
  })
})

describe('defaultMeetingTitle', () => {
  test('M월 D일 회의록 형식을 만든다', () => {
    expect(defaultMeetingTitle(new Date(2026, 6, 20, 9, 5, 0))).toBe('7월 20일 회의록')
  })
  test('월과 일이 패딩되지 않는다 (자연수 표기)', () => {
    expect(defaultMeetingTitle(new Date(2026, 0, 3, 0, 7, 0))).toBe('1월 3일 회의록')
  })
})

describe('formatStartTime', () => {
  test('ISO8601에서 HH:mm을 추출한다', () => {
    expect(formatStartTime('2026-07-23T14:05:00+09:00')).toBe('14:05')
  })
  test('형식이 어긋나면 빈 문자열을 반환한다', () => {
    expect(formatStartTime('bad')).toBe('')
  })
})

describe('serialize → parse 왕복', () => {
  test('직렬화한 마크다운을 다시 파싱하면 동일한 데이터가 나온다', () => {
    const raw = serializeMeeting(meeting)
    const parsed = parseMeeting('2026-07-20-주간-스탠드업.md', raw)
    expect(parsed.meetingType).toBe('general')
    expect(parsed.title).toBe(meeting.title)
    expect(parsed.durationMin).toBe(32)
    expect(parsed.participants).toEqual(['조엘', '케빈'])
    expect(parsed.summary).toBe(meeting.summary)
    expect(parsed.sections).toEqual(meeting.sections)
    expect(parsed.segments).toEqual(meeting.segments)
  })
  test('직렬화 출력은 스펙 형식을 따른다', () => {
    const raw = serializeMeeting(meeting)
    expect(raw).toContain('duration: 32m')
    expect(raw).toContain('type: general')
    expect(raw).toContain('## 요약')
    expect(raw).toContain('## 액션아이템')
    expect(raw).toContain('- [ ] API 명세 초안 작성 (담당: 조엘)')
    expect(raw).toContain('## 트랜스크립트')
    expect(raw).toContain('[00:00:12] 오늘 스프린트 목표부터 정리하겠습니다.')
  })
  test('요약·섹션이 비어 있어도(요약 실패 폴백) 왕복된다', () => {
    const raw = serializeMeeting({ ...meeting, summary: '', sections: [] })
    const parsed = parseMeeting('a.md', raw)
    expect(parsed.summary).toBe('')
    expect(parsed.sections).toEqual([])
    expect(parsed.segments).toHaveLength(2)
  })

  test('타입별 섹션(list/actions 혼합)이 순서대로 왕복된다', () => {
    const daily = {
      ...meeting,
      meetingType: 'daily',
      sections: [
        { heading: '진척', kind: 'list' as const, items: ['A 완료', 'B 진행'] },
        { heading: '블로커', kind: 'list' as const, items: ['C 대기'] },
        { heading: '오늘 할 일', kind: 'actions' as const, items: [{ text: 'D 배포', assignee: '영희' }] },
      ],
    }
    const parsed = parseMeeting('f.md', serializeMeeting(daily))
    expect(parsed.meetingType).toBe('daily')
    expect(parsed.sections).toEqual(daily.sections)
  })

  test('text 섹션(문단)이 왕복된다', () => {
    const withText = {
      ...meeting,
      meetingType: 'idea',
      sections: [
        { heading: '아이디어', kind: 'list' as const, items: ['x', 'y'] },
        { heading: '메모', kind: 'text' as const, text: '자유 서술 문단.' },
      ],
    }
    const parsed = parseMeeting('f.md', serializeMeeting(withText))
    expect(parsed.sections).toEqual(withText.sections)
  })

  test('하위호환: type 없는 기존 파일은 general + actions 섹션으로 읽힌다', () => {
    const legacy = [
      '---', 'title: 옛 회의', "date: '2026-07-01T10:00:00+09:00'", 'duration: 30m',
      'participants:', '  - 철수', '---', '',
      '## 요약', '', '지난 회의 요약.', '',
      '## 액션아이템', '', '- [ ] 문서 작성 (담당: 철수)', '',
      '## 트랜스크립트', '', '[00:00:00] 시작',
    ].join('\n')
    const parsed = parseMeeting('legacy.md', legacy)
    expect(parsed.meetingType).toBe('general')
    expect(parsed.summary).toBe('지난 회의 요약.')
    expect(parsed.sections).toEqual([
      { heading: '액션아이템', kind: 'actions', items: [{ text: '문서 작성', assignee: '철수' }] },
    ])
    expect(parsed.segments).toEqual([{ startMs: 0, text: '시작' }])
  })

  test('제목에 콜론이 있어도 파싱이 깨지지 않고 왕복된다 (문자열 연결 직렬화는 gray-matter 파싱을 THROW시킴)', () => {
    const withColon = { ...meeting, title: '주간회의: 스프린트 리뷰' }
    const raw = serializeMeeting(withColon)
    expect(() => parseMeeting('a.md', raw)).not.toThrow()
    const parsed = parseMeeting('a.md', raw)
    expect(parsed.title).toBe('주간회의: 스프린트 리뷰')
    expect(parsed.date).toBe(meeting.date)
  })

  test('제목에 #이 있어도 잘리지 않고 왕복된다', () => {
    const withHash = { ...meeting, title: 'Q&A 세션 #1' }
    const raw = serializeMeeting(withHash)
    const parsed = parseMeeting('a.md', raw)
    expect(parsed.title).toBe('Q&A 세션 #1')
  })

  test('참석자 이름에 쉼표가 있어도 개별 항목으로 왕복된다', () => {
    const withComma = { ...meeting, participants: ['김,철수', '조엘'] }
    const raw = serializeMeeting(withComma)
    const parsed = parseMeeting('a.md', raw)
    expect(parsed.participants).toEqual(['김,철수', '조엘'])
  })

  test('date의 +09:00 오프셋이 문자열로 그대로 보존된다(따옴표 없으면 YAML이 timestamp로 오인)', () => {
    const raw = serializeMeeting(meeting)
    const parsed = parseMeeting('a.md', raw)
    expect(parsed.date).toBe('2026-07-20T10:30:00+09:00')
  })

  test('recorder가 있으면 frontmatter 최상단에 쓰고 왕복된다', () => {
    const withRecorder = { ...meeting, recorder: 'joel' }
    const raw = serializeMeeting(withRecorder)
    const fmLines = raw.split('\n\n')[0].split('\n')
    expect(fmLines[1]).toBe('recorder: joel') // fmLines[0]은 '---'
    const parsed = parseMeeting('a.md', raw)
    expect(parsed.recorder).toBe('joel')
  })

  test('recorder가 없으면 frontmatter에 필드 자체가 없고 파싱 결과에도 없다', () => {
    const raw = serializeMeeting(meeting)
    expect(raw).not.toContain('recorder:')
    const parsed = parseMeeting('a.md', raw)
    expect(parsed.recorder).toBeUndefined()
  })
})

describe('isValidMeetingFilename', () => {
  test('.md로 끝나고 경로 구분자·상위 이동이 없으면 true', () => {
    expect(isValidMeetingFilename('2026-07-20-회의.md')).toBe(true)
  })
  test('.md가 아니면 false', () => {
    expect(isValidMeetingFilename('2026-07-20-회의.txt')).toBe(false)
  })
  test('경로 구분자(슬래시·역슬래시)가 있으면 false', () => {
    expect(isValidMeetingFilename('../secret.md')).toBe(false)
    expect(isValidMeetingFilename('a/b.md')).toBe(false)
    expect(isValidMeetingFilename('a\\b.md')).toBe(false)
  })
  test('상위 이동(..)이 포함되면 false', () => {
    expect(isValidMeetingFilename('..md')).toBe(false)
  })
})
