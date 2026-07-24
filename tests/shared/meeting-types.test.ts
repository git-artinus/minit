import { describe, expect, test } from 'vitest'
import { MEETING_TYPES, DEFAULT_MEETING_TYPE, meetingTypeDef } from '../../src/shared/meeting-types'

describe('meeting-types 레지스트리', () => {
  test('기본 타입은 general이고 첫 항목이다', () => {
    expect(DEFAULT_MEETING_TYPE).toBe('general')
    expect(MEETING_TYPES[0].id).toBe('general')
  })
  test('MVP 6개 타입 id가 모두 있다', () => {
    expect(MEETING_TYPES.map((t) => t.id)).toEqual(['general', 'daily', 'weekly', 'idea', 'deepdive', 'quick'])
  })
  test('general은 actions 섹션 하나(액션아이템)를 갖는다', () => {
    expect(meetingTypeDef('general').sectionDefs).toEqual([{ heading: '액션아이템', kind: 'actions' }])
  })
  test('quick은 섹션이 없다', () => {
    expect(meetingTypeDef('quick').sectionDefs).toEqual([])
  })
  test('미지의 id는 general로 폴백한다', () => {
    expect(meetingTypeDef('없는타입').id).toBe('general')
    expect(meetingTypeDef(undefined).id).toBe('general')
  })
  test('모든 타입은 비어있지 않은 promptGuidance를 갖는다', () => {
    for (const t of MEETING_TYPES) expect(t.promptGuidance.length).toBeGreaterThan(0)
  })
})
