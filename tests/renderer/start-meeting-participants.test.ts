import { describe, expect, test } from 'vitest'
import { collapseMembers, splitParticipants } from '../../src/shared/slack-members'

const members = [
  { id: 'U001', name: 'Ivy(김하나)' },
  { id: 'U002', name: 'Max(이두리)' }
]

describe('splitParticipants', () => {
  test('Slack 멤버와 게스트를 나눈다', () => {
    const result = splitParticipants(['Ivy(김하나)', '외부 자문위원'], members)
    expect(result.slack).toEqual(['Ivy(김하나)'])
    expect(result.guests).toEqual(['외부 자문위원'])
  })

  test('Slack 멤버가 없으면 전부 게스트다', () => {
    expect(splitParticipants(['김철수'], []).guests).toEqual(['김철수'])
  })

  test('대소문자가 다르면 게스트로 본다', () => {
    expect(splitParticipants(['ivy(김하나)'], members).guests).toEqual(['ivy(김하나)'])
  })

  test('선택된 적 없는 Slack 멤버는 어느 쪽에도 들어가지 않는다', () => {
    const result = splitParticipants(['Ivy(김하나)'], members)
    expect(result.slack).not.toContain('Max(이두리)')
    expect(result.guests).not.toContain('Max(이두리)')
  })

  test('빈 선택이면 양쪽 모두 비어 있다', () => {
    expect(splitParticipants([], members)).toEqual({ slack: [], guests: [] })
  })
})

describe('collapseMembers', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `U${i}`, name: `M${i}` }))
  const none: ReadonlySet<string> = new Set()

  test('회의 이력이 있는 사람만 펼쳐 보여준다', () => {
    const known = new Set(['M2', 'M7'])
    expect(collapseMembers(many, none, known, 10).map((m) => m.name)).toEqual(['M2', 'M7'])
  })

  test('이력이 없어도 선택된 사람은 남긴다 — 고른 참석자가 숨으면 안 된다', () => {
    const result = collapseMembers(many, new Set(['M11']), new Set(['M2']), 10)
    expect(result.map((m) => m.name)).toEqual(['M2', 'M11'])
  })

  test('이력이 전혀 없으면 앞에서 fallbackLimit명을 보여준다(최초 사용)', () => {
    expect(collapseMembers(many, none, none, 10)).toHaveLength(10)
  })

  test('이력이 없고 인원도 적으면 전원을 보여준다', () => {
    const few = many.slice(0, 3)
    expect(collapseMembers(few, none, none, 10)).toEqual(few)
  })

  test('정렬 순서를 바꾸지 않는다 — 선택할 때마다 목록이 뒤바뀌면 고르기 어렵다', () => {
    const known = new Set(['M9', 'M1'])
    expect(collapseMembers(many, none, known, 10).map((m) => m.name)).toEqual(['M1', 'M9'])
  })

  test('이력자와 선택자가 겹쳐도 중복으로 들어가지 않는다', () => {
    const result = collapseMembers(many, new Set(['M1']), new Set(['M1']), 10)
    expect(result).toHaveLength(1)
  })

  test('전원이 이력자면 전원을 보여준다(fallbackLimit을 넘겨도)', () => {
    const known = new Set(many.map((m) => m.name))
    expect(collapseMembers(many, none, known, 10)).toHaveLength(12)
  })
})
