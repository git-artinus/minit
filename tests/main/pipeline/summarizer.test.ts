import { describe, expect, test } from 'vitest'
import {
  buildPrompt, InvalidOutputError, parseClaudeOutput, summarize
} from '../../../src/main/pipeline/summarizer'
import { meetingTypeDef } from '../../../src/shared/meeting-types'
import type { ActionItem } from '../../../src/shared/types'

const general = meetingTypeDef('general')
const daily = meetingTypeDef('daily')
const weekly = meetingTypeDef('weekly')
const quick = meetingTypeDef('quick')

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
  // 평범한 Error로 되돌리면 분류기가 invalid_output을 못 가리고 응답 원문도 사라진다.
  // 타입과 원문 보존을 함께 못 박아야 그 회귀가 잡힌다.
  test('JSON이 없으면 InvalidOutputError를 던지고 응답 원문을 보존한다', () => {
    const response = '죄송합니다, 요약을 만들 수 없었습니다.'
    expect(() => parseClaudeOutput(response, general)).toThrow(InvalidOutputError)
    try {
      parseClaudeOutput(response, general)
      throw new Error('던져야 한다')
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidOutputError)
      expect((e as InvalidOutputError).raw).toBe(response)
    }
  })

  // 절단은 분류기가 앞뒤 보존·생략 고지 정책으로 처리한다 — 여기서 미리 자르면 정책이 이원화된다.
  test('원문을 자르지 않고 그대로 실어 보낸다', () => {
    const long = 'x'.repeat(5000)
    try {
      parseClaudeOutput(long, general)
      throw new Error('던져야 한다')
    } catch (e) {
      expect((e as InvalidOutputError).raw).toHaveLength(5000)
    }
  })
  // 기준선은 프롬프트 층에서만 쓴다. 파서가 자르면 "중요도 순"이 틀렸을 때 핵심이 조용히 사라진다.
  test('기준선을 초과한 항목도 자르지 않는다', () => {
    const many = Array.from({ length: 12 }, (_, i) => `결정 ${i}`)
    const stdout = JSON.stringify({ summary: 's', sections: { 결정사항: many, '진행 상황': [], '다음 주 액션아이템': [] } })
    const out = parseClaudeOutput(stdout, meetingTypeDef('weekly'))
    const decisions = out.sections.find((s) => s.heading === '결정사항')
    expect(decisions?.kind).toBe('list')
    expect(decisions && decisions.kind === 'list' ? decisions.items : []).toHaveLength(12)
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
  test('타입별 요약 분량 지침과 문단 규약을 담는다', () => {
    expect(buildPrompt(weekly, '위클리', [])).toContain('1~2문단(문단당 3~4문장)')
    expect(buildPrompt(weekly, '위클리', [])).toContain('문단은 빈 줄로 구분한다')
    expect(buildPrompt(quick, '간이', [])).toContain('2~3문장')
  })
  test('섹션별 기준선을 개수와 함께 담는다', () => {
    const p = buildPrompt(weekly, '위클리', [])
    expect(p).toContain('결정사항 4개')
    expect(p).toContain('진행 상황 4개')
    expect(p).toContain('다음 주 액션아이템 5개')
    expect(p).toContain('안팎')
  })
  // 상한 어법은 코드로 자르지 않아도 LLM이 스스로 중요한 항목을 버리게 만든다.
  // 부정 단언은 실제로 들어올 법한 형태를 잡아야 한다 — '상한을 넘기지 마라' 같은 정확한
  // 어구만 막으면 '최대 4개'·'4개 이하로'가 그대로 통과해 테스트가 통과만 하는 껍데기가 된다.
  // '넘기지 마라'로 넓힐 수는 없다: 같은 프롬프트의 '80자를 넘기지 마라'가 걸린다.
  test('기준선을 상한으로 지시하지 않는다', () => {
    const p = buildPrompt(weekly, '위클리', [])
    expect(p).toContain('중요한 내용이 빠지느니 기준선을 넘기는 편이 낫다')
    expect(p).not.toMatch(/최대 \d+개|\d+개 이하|\d+개를 넘기지 마라|개수를 초과/)
  })
  test('병합·중복 배제 규칙을 담는다', () => {
    const p = buildPrompt(weekly, '위클리', [])
    expect(p).toContain('하나로 합쳐라')
    expect(p).toContain('요약에 이미 쓴 내용을 항목으로 반복하지 마라')
    expect(p).toContain('80자')
  })
  test('섹션이 없는 타입에는 항목 규칙을 넣지 않는다', () => {
    const p = buildPrompt(quick, '간이', [])
    expect(p).not.toContain('안팎')
    expect(p).not.toContain('80자')
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
