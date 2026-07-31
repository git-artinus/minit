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
    expect(meetingTypeDef('general').sectionDefs)
      .toEqual([{ heading: '액션아이템', kind: 'actions', typicalItems: 5 }])
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
  test('모든 타입은 비어있지 않은 summaryGuide를 갖는다', () => {
    for (const t of MEETING_TYPES) expect(t.summaryGuide.length).toBeGreaterThan(0)
  })
  test('모든 섹션은 1 이상의 typicalItems를 갖는다', () => {
    for (const t of MEETING_TYPES) {
      for (const s of t.sectionDefs) expect(s.typicalItems).toBeGreaterThan(0)
    }
  })
  test('위클리 섹션은 결정사항·진행 상황·다음 주 액션아이템이다', () => {
    expect(meetingTypeDef('weekly').sectionDefs.map((s) => s.heading))
      .toEqual(['결정사항', '진행 상황', '다음 주 액션아이템'])
  })
  // 아이디어 타입은 발산이 목적이라(promptGuidance) 다른 타입과 같은 기준선을 쓰면 취지에 반한다.
  test('아이디어 섹션의 기준선은 다른 타입보다 넉넉하다', () => {
    const idea = meetingTypeDef('idea').sectionDefs.find((s) => s.heading === '아이디어')
    expect(idea?.typicalItems).toBe(7)
  })
})
