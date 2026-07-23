import { describe, expect, test } from 'vitest'
import { parseClaudeOutput, summarize } from '../../../src/main/pipeline/summarizer'

const valid = JSON.stringify({
  summary: '스프린트 목표를 정리했다.',
  actionItems: [{ text: 'API 명세 초안 작성', assignee: '조엘' }],
})

describe('parseClaudeOutput', () => {
  test('순수 JSON을 파싱한다', () => {
    expect(parseClaudeOutput(valid).summary).toBe('스프린트 목표를 정리했다.')
  })
  test('코드펜스로 감싼 JSON도 파싱한다', () => {
    expect(parseClaudeOutput('```json\n' + valid + '\n```').actionItems).toHaveLength(1)
  })
  test('앞뒤에 설명 텍스트가 붙어도 첫 JSON 객체를 파싱한다', () => {
    expect(parseClaudeOutput('결과입니다.\n' + valid + '\n끝.').summary).toContain('스프린트')
  })
  test('JSON이 없으면 throw한다 (파이프라인이 요약 실패로 처리)', () => {
    expect(() => parseClaudeOutput('죄송합니다, 실패했습니다.')).toThrow()
  })
  test('assignee 없는 액션아이템도 허용한다', () => {
    const out = parseClaudeOutput(JSON.stringify({ summary: 's', actionItems: [{ text: 't' }] }))
    expect(out.actionItems[0]).toEqual({ text: 't' })
  })
  test('프로즈에 중괄호가 섞여 있어도 실제 JSON을 찾아 파싱한다', () => {
    const stdout = '예시는 {foo} 형태다.\n' + valid + '\n{끝}'
    expect(parseClaudeOutput(stdout).summary).toBe('스프린트 목표를 정리했다.')
  })
  test('프로즈에 중괄호가 있어도 코드펜스 안의 JSON을 우선 파싱한다', () => {
    const stdout = '설명 {bar}\n```json\n' + valid + '\n```\n뒷말 {baz}'
    expect(parseClaudeOutput(stdout).summary).toBe('스프린트 목표를 정리했다.')
  })
  test('actionItems 중 유효하지 않은 요소는 제거하고, 유효한 필드만 남긴다', () => {
    const stdout = JSON.stringify({
      summary: 's',
      actionItems: ['문자열', { no: 'text' }, { text: '유효' }, { text: '둘', assignee: '조엘', due: '' }],
    })
    const out = parseClaudeOutput(stdout)
    expect(out.actionItems).toEqual([{ text: '유효' }, { text: '둘', assignee: '조엘' }])
  })
})

describe('summarize', () => {
  test('claude -p에 트랜스크립트를 stdin으로 넘긴다', async () => {
    let captured: { args: string[]; stdin: string } | null = null
    const result = await summarize({
      run: async (_cmd, args, stdin) => { captured = { args, stdin }; return { stdout: valid } },
      title: '주간 스탠드업',
      segments: [{ startMs: 0, text: '안녕하세요.' }],
    })
    expect(captured!.args[0]).toBe('-p')
    expect(captured!.stdin).toContain('[00:00:00] 안녕하세요.')
    expect(result.summary).toContain('스프린트')
  })
})
