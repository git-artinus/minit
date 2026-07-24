import { describe, expect, test } from 'vitest'
import { buildPrompt, parseClaudeOutput, summarize } from '../../../src/main/pipeline/summarizer'
import { meetingTypeDef } from '../../../src/shared/meeting-types'
import type { ActionItem } from '../../../src/shared/types'

const general = meetingTypeDef('general')
const daily = meetingTypeDef('daily')

const valid = JSON.stringify({
  summary: '스프린트 목표를 정리했다.',
  sections: { 액션아이템: [{ text: 'API 명세 초안 작성', assignee: '조엘' }] },
})

function actionsOf(out: ReturnType<typeof parseClaudeOutput>, heading: string): ActionItem[] {
  const s = out.sections.find((x) => x.heading === heading)
  if (!s || s.kind !== 'actions') throw new Error(`actions 섹션 아님: ${heading}`)
  return s.items
}

describe('parseClaudeOutput', () => {
  test('순수 JSON을 파싱한다', () => {
    expect(parseClaudeOutput(valid, general).summary).toBe('스프린트 목표를 정리했다.')
  })
  test('코드펜스로 감싼 JSON도 파싱한다', () => {
    expect(actionsOf(parseClaudeOutput('```json\n' + valid + '\n```', general), '액션아이템')).toHaveLength(1)
  })
  test('앞뒤에 설명 텍스트가 붙어도 첫 JSON 객체를 파싱한다', () => {
    expect(parseClaudeOutput('결과입니다.\n' + valid + '\n끝.', general).summary).toContain('스프린트')
  })
  test('JSON이 없으면 throw한다 (파이프라인이 요약 실패로 처리)', () => {
    expect(() => parseClaudeOutput('죄송합니다, 실패했습니다.', general)).toThrow()
  })
  test('assignee 없는 액션아이템도 허용한다', () => {
    const out = parseClaudeOutput(JSON.stringify({ summary: 's', sections: { 액션아이템: [{ text: 't' }] } }), general)
    expect(actionsOf(out, '액션아이템')[0]).toEqual({ text: 't' })
  })
  test('프로즈에 중괄호가 섞여 있어도 실제 JSON을 찾아 파싱한다', () => {
    const stdout = '예시는 {foo} 형태다.\n' + valid + '\n{끝}'
    expect(parseClaudeOutput(stdout, general).summary).toBe('스프린트 목표를 정리했다.')
  })
  test('프로즈에 중괄호가 있어도 코드펜스 안의 JSON을 우선 파싱한다', () => {
    const stdout = '설명 {bar}\n```json\n' + valid + '\n```\n뒷말 {baz}'
    expect(parseClaudeOutput(stdout, general).summary).toBe('스프린트 목표를 정리했다.')
  })
  test('액션아이템 중 유효하지 않은 요소는 제거하고, 문자열 원소는 text로 받아들인다', () => {
    const stdout = JSON.stringify({
      summary: 's',
      sections: { 액션아이템: ['문자열 할 일', { no: 'text' }, { text: '유효' }, { text: '둘', assignee: '조엘', due: '' }] },
    })
    const out = parseClaudeOutput(stdout, general)
    expect(actionsOf(out, '액션아이템')).toEqual([
      { text: '문자열 할 일' },
      { text: '유효' },
      { text: '둘', assignee: '조엘' },
    ])
  })
  test('daily 타입: 섹션이 타입 정의 순서·kind로 매핑된다', () => {
    const stdout = JSON.stringify({
      summary: '요약문',
      sections: { 진척: ['A 완료'], 블로커: [], '오늘 할 일': [{ text: 'D 배포', assignee: '영희' }] },
    })
    const out = parseClaudeOutput(stdout, daily)
    expect(out.sections).toEqual([
      { heading: '진척', kind: 'list', items: ['A 완료'] },
      { heading: '블로커', kind: 'list', items: [] },
      { heading: '오늘 할 일', kind: 'actions', items: [{ text: 'D 배포', assignee: '영희' }] },
    ])
  })
  test('누락된 섹션은 빈 값으로 채운다', () => {
    const out = parseClaudeOutput(JSON.stringify({ summary: 's', sections: {} }), daily)
    expect(out.sections.map((x) => x.heading)).toEqual(['진척', '블로커', '오늘 할 일'])
    expect(out.sections.every((x) => (x.kind === 'text' ? x.text === '' : x.items.length === 0))).toBe(true)
  })
  test('quick 타입: sections가 없어도 summary만으로 성공한다', () => {
    const out = parseClaudeOutput(JSON.stringify({ summary: '짧은 요약' }), meetingTypeDef('quick'))
    expect(out.summary).toBe('짧은 요약')
    expect(out.sections).toEqual([])
  })
})

describe('buildPrompt', () => {
  test('타입 지침과 섹션 키를 포함한다', () => {
    const p = buildPrompt(daily, '데일리', [])
    expect(p).toContain('데일리 스탠드업')
    expect(p).toContain('"진척"')
    expect(p).toContain('"오늘 할 일"')
  })
  test('참석자 명단과 STT 교정 지침을 포함한다', () => {
    const p = buildPrompt(daily, '데일리', ['철수', '영희'])
    expect(p).toContain('철수, 영희')
    expect(p).toMatch(/오인식|교정/)
    expect(p).toContain('명단에 없는 이름을 지어내지 마라')
  })
  test('참석자가 없으면 교정 지침을 넣지 않는다', () => {
    expect(buildPrompt(daily, '데일리', [])).not.toMatch(/오인식/)
  })
})

describe('summarize', () => {
  test('claude -p에 트랜스크립트를 stdin으로 넘기고 타입 프롬프트를 쓴다', async () => {
    let captured: { args: string[]; stdin: string } | null = null
    const result = await summarize({
      run: async (_cmd, args, stdin) => { captured = { args, stdin }; return { stdout: valid } },
      title: '주간 스탠드업',
      segments: [{ startMs: 0, text: '안녕하세요.' }],
      participants: ['조엘'],
      typeDef: general,
    })
    expect(captured!.args[0]).toBe('-p')
    expect(captured!.args[1]).toContain('조엘')
    expect(captured!.stdin).toContain('[00:00:00] 안녕하세요.')
    expect(result.summary).toContain('스프린트')
  })
})
