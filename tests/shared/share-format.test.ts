import { describe, expect, test } from 'vitest'
import {
  buildPlainText,
  buildShareMarkdown,
  buildTranscriptText,
  exportContent,
  exportFileName
} from '../../src/shared/share-format'
import { serializeMeeting } from '../../src/shared/meeting-file'
import type { Meeting } from '../../src/shared/types'

const meeting: Meeting = {
  filename: '2026-07-20-주간-스탠드업.md',
  meetingType: 'general',
  title: '주간 스탠드업',
  date: '2026-07-20T10:30:00+09:00',
  durationMin: 32,
  participants: ['조엘', '케빈'],
  summary: '스프린트 목표를 정리했다.',
  sections: [
    { heading: '논의', kind: 'list', items: ['배포 일정', '테스트 범위'] },
    { heading: '액션아이템', kind: 'actions', items: [{ text: 'API 명세 초안 작성', assignee: '조엘', due: '7/25' }] },
  ],
  segments: [
    { startMs: 12_000, text: '오늘 스프린트 목표부터 정리하겠습니다.' },
    { startMs: 45_000, text: '지난주 이슈 공유드립니다.' },
  ],
}

describe('buildShareMarkdown', () => {
  test('제목·메타 헤더와 요약, 모든 섹션을 마크다운으로 담는다', () => {
    const md = buildShareMarkdown(meeting)
    expect(md).toBe(
      [
        '# 주간 스탠드업',
        '',
        '2026-07-20 10:30 · 32분 · 일반 · 참석자: 조엘, 케빈',
        '',
        '## 요약',
        '',
        '스프린트 목표를 정리했다.',
        '',
        '## 논의',
        '',
        '- 배포 일정',
        '- 테스트 범위',
        '',
        '## 액션아이템',
        '',
        '- [ ] API 명세 초안 작성 (담당: 조엘) (기한: 7/25)',
      ].join('\n')
    )
  })

  test('트랜스크립트는 담지 않는다', () => {
    expect(buildShareMarkdown(meeting)).not.toContain('오늘 스프린트 목표부터')
  })

  test('빈 섹션은 생략한다', () => {
    const md = buildShareMarkdown({
      ...meeting,
      sections: [{ heading: '결정사항', kind: 'list', items: [] }, ...meeting.sections],
    })
    expect(md).not.toContain('결정사항')
  })

  test('요약이 없으면 요약 블록을 생략한다', () => {
    const md = buildShareMarkdown({ ...meeting, summary: '   ' })
    expect(md).not.toContain('## 요약')
    expect(md).toContain('## 논의')
  })

  test('참석자가 없으면 참석자 없음으로 표기한다', () => {
    expect(buildShareMarkdown({ ...meeting, participants: [] })).toContain('참석자 없음')
  })
})

describe('buildPlainText', () => {
  test('마크다운 기호 없이 요약·섹션·트랜스크립트를 담는다', () => {
    expect(buildPlainText(meeting)).toBe(
      [
        '주간 스탠드업',
        '2026-07-20 10:30 · 32분 · 일반 · 참석자: 조엘, 케빈',
        '',
        '== 요약 ==',
        '',
        '스프린트 목표를 정리했다.',
        '',
        '== 논의 ==',
        '',
        '- 배포 일정',
        '- 테스트 범위',
        '',
        '== 액션아이템 ==',
        '',
        '- API 명세 초안 작성 (담당: 조엘) (기한: 7/25)',
        '',
        '== 트랜스크립트 ==',
        '',
        '[00:00:12] 오늘 스프린트 목표부터 정리하겠습니다.',
        '[00:00:45] 지난주 이슈 공유드립니다.',
      ].join('\n')
    )
  })

  test('트랜스크립트가 없으면 트랜스크립트 블록을 생략한다', () => {
    expect(buildPlainText({ ...meeting, segments: [] })).not.toContain('트랜스크립트')
  })
})

describe('buildTranscriptText', () => {
  test('문단마다 타임스탬프와 텍스트를 한 줄로 담는다', () => {
    const text = buildTranscriptText([
      { startMs: 12_000, text: '오늘 스프린트 목표부터 정리하겠습니다.' },
      { startMs: 45_000, text: '지난주 이슈 공유드립니다.' }
    ])
    expect(text).toBe(
      [
        '[00:00:12] 오늘 스프린트 목표부터 정리하겠습니다.',
        '[00:00:45] 지난주 이슈 공유드립니다.'
      ].join('\n')
    )
  })

  test('문단이 없으면 빈 문자열이다', () => {
    expect(buildTranscriptText([])).toBe('')
  })
})

describe('exportFileName', () => {
  test('md는 회의록 파일명을 그대로 쓴다', () => {
    expect(exportFileName('2026-07-20-주간-스탠드업.md', 'md')).toBe('2026-07-20-주간-스탠드업.md')
  })
  test('txt는 확장자만 바꾼다', () => {
    expect(exportFileName('2026-07-20-주간-스탠드업.md', 'txt')).toBe('2026-07-20-주간-스탠드업.txt')
  })
})

describe('exportContent', () => {
  const raw = serializeMeeting(meeting)

  test('md는 저장된 원본을 그대로 내보낸다', () => {
    expect(exportContent(meeting.filename, raw, 'md')).toBe(raw)
  })

  test('txt는 frontmatter를 걷어낸 평문으로 바꾼다', () => {
    const txt = exportContent(meeting.filename, raw, 'txt')
    expect(txt).not.toContain('---')
    expect(txt).toContain('== 요약 ==')
    expect(txt).toContain('[00:00:12] 오늘 스프린트 목표부터 정리하겠습니다.')
  })
})
