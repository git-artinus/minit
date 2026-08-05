import { describe, expect, test } from 'vitest'
import { splitParticipants } from '../../src/shared/slack-members'

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
