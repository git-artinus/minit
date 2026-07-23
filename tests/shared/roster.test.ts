import { describe, expect, test } from 'vitest'
import { dedupeAndSort, mergeNames, parseRoster, removeParticipant, renameParticipant, resolveMemberName } from '../../src/shared/roster'
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

describe('dedupeAndSort', () => {
  // 정렬 결과는 localeCompare('ko') collation 순서를 그대로 따른다(풀 ICU 기준 한글이 라틴
  // 문자보다 먼저 온다). dedup 자체(대소문자 무시·첫 표기 승리)는 정렬 전 ['Bob','alice','홍길동'].
  test('trim·빈값 제거·대소문자 무시 dedup(첫 표기 승리)·한국어 정렬', () => {
    expect(dedupeAndSort([' Bob ', 'alice', 'Alice', '', 'bob', '홍길동'])).toEqual([
      '홍길동',
      'alice',
      'Bob'
    ])
  })
})

describe('mergeNames', () => {
  test('기존에 없는 이름만 추가하고 신규/중복 수를 센다', () => {
    const r = mergeNames({ participants: ['Alice'] }, ['Bob', 'alice', 'Carol'])
    expect(r.roster.participants).toEqual(['Alice', 'Bob', 'Carol'])
    expect(r.addedCount).toBe(2)
    expect(r.skippedCount).toBe(1)
  })

  test('배치 내 중복·빈값은 정리되어 카운트에 반영된다', () => {
    const r = mergeNames({ participants: [] }, ['Bob', 'bob', '', '  '])
    expect(r.roster.participants).toEqual(['Bob'])
    expect(r.addedCount).toBe(1)
    expect(r.skippedCount).toBe(0)
  })
})

describe('renameParticipant', () => {
  test('대상 이름 표기를 변경하고 정렬을 유지한다', () => {
    expect(renameParticipant({ participants: ['Alice', 'Bob'] }, 'bob', 'Carol'))
      .toEqual({ participants: ['Alice', 'Carol'] })
  })
  test('없는 이름이면 원본을 그대로 반환한다', () => {
    expect(renameParticipant({ participants: ['Alice'] }, 'Zoe', 'Xavier'))
      .toEqual({ participants: ['Alice'] })
  })
  test('빈 문자열로는 변경하지 않는다', () => {
    expect(renameParticipant({ participants: ['Alice'] }, 'Alice', '  '))
      .toEqual({ participants: ['Alice'] })
  })
  test('다른 기존 항목과 충돌하면 병합(중복 제거)된다', () => {
    expect(renameParticipant({ participants: ['Alice', 'Bob'] }, 'Bob', 'alice'))
      .toEqual({ participants: ['Alice'] })
  })
  test('이름 변경이 기존 항목과 충돌하면 기존 표기가 유지된다(위치 무관)', () => {
    expect(renameParticipant({ participants: ['Bob', 'Zoe'] }, 'Bob', 'ZOE'))
      .toEqual({ participants: ['Zoe'] })
  })
})

describe('removeParticipant', () => {
  test('대소문자 무시로 항목을 제거한다', () => {
    expect(removeParticipant({ participants: ['Alice', 'Bob'] }, 'BOB'))
      .toEqual({ participants: ['Alice'] })
  })
})
