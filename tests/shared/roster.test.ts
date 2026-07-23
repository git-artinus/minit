import { describe, expect, test } from 'vitest'
import { parseRoster, resolveMemberName } from '../../src/shared/roster'
import type { Roster } from '../../src/shared/types'

describe('parseRoster', () => {
  test('정상 JSON을 Roster로 파싱한다', () => {
    const raw = JSON.stringify({ participants: ['Joel', 'Hank'] })
    expect(parseRoster(raw)).toEqual({ participants: ['Joel', 'Hank'] })
  })

  test('participants가 빈 배열이어도 파싱된다', () => {
    expect(parseRoster(JSON.stringify({ participants: [] }))).toEqual({ participants: [] })
  })

  test('JSON 문법 자체가 깨졌으면 throw', () => {
    expect(() => parseRoster('{oops')).toThrow()
  })

  test('participants가 배열이 아니면 throw', () => {
    expect(() => parseRoster(JSON.stringify({ participants: 'Joel' }))).toThrow()
  })

  test('participants 필드가 아예 없으면 throw', () => {
    expect(() => parseRoster(JSON.stringify({}))).toThrow()
  })

  test('participants 원소가 문자열이 아니면 throw', () => {
    expect(() => parseRoster(JSON.stringify({ participants: ['Joel', 1] }))).toThrow()
  })

  test('최상위가 객체가 아니면 throw', () => {
    expect(() => parseRoster(JSON.stringify(['Joel']))).toThrow()
  })
})

describe('resolveMemberName', () => {
  const roster: Roster = { participants: ['Joel', 'Hank'] }

  test('대소문자 무시하고 exact 매칭되면 로스터에 저장된 원본 표기를 반환한다', () => {
    expect(resolveMemberName(roster, 'joel')).toBe('Joel')
    expect(resolveMemberName(roster, 'JOEL')).toBe('Joel')
  })

  test('input을 trim한 뒤 매칭한다', () => {
    expect(resolveMemberName(roster, '  Joel  ')).toBe('Joel')
  })

  test('일치하는 이름이 없으면 trim된 input을 그대로 반환한다', () => {
    expect(resolveMemberName(roster, '외부손님')).toBe('외부손님')
  })

  test('부분 일치는 매칭하지 않는다(exact만)', () => {
    expect(resolveMemberName(roster, 'Joe')).toBe('Joe')
  })

  test('roster가 null이면 trim된 input을 그대로 반환한다', () => {
    expect(resolveMemberName(null, '  외부손님  ')).toBe('외부손님')
  })
})
