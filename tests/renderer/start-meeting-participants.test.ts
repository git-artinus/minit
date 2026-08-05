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

  test('limit 이하면 그대로 반환한다', () => {
    const few = many.slice(0, 3)
    expect(collapseMembers(few, new Set(), 8)).toEqual(few)
  })

  test('limit을 넘으면 앞에서부터 limit명만 남긴다', () => {
    expect(collapseMembers(many, new Set(), 8)).toHaveLength(8)
  })

  test('잘린 구간에 선택된 사람이 있으면 함께 남긴다 — 고른 참석자가 숨으면 안 된다', () => {
    const result = collapseMembers(many, new Set(['M10']), 8)
    expect(result.map((m) => m.name)).toContain('M10')
    expect(result).toHaveLength(9)
  })

  test('정렬 순서를 바꾸지 않는다 — 선택할 때마다 목록이 뒤바뀌면 고르기 어렵다', () => {
    const result = collapseMembers(many, new Set(['M11']), 8)
    expect(result.map((m) => m.name)).toEqual(['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M11'])
  })

  test('앞쪽에서 선택된 사람은 중복으로 들어가지 않는다', () => {
    const result = collapseMembers(many, new Set(['M1']), 8)
    expect(result).toHaveLength(8)
  })
})
