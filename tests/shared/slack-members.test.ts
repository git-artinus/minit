import { describe, expect, test } from 'vitest'
import {
  classifySyncError,
  findMentionId,
  membersInMeeting,
  parseSlackMembers,
  toSlackMembers,
  visibleGuests,
  type SlackApiUser
} from '../../src/shared/slack-members'

function apiUser(over: Partial<SlackApiUser> = {}): SlackApiUser {
  return {
    id: 'U001',
    name: 'ivy',
    real_name: 'Ivy',
    deleted: false,
    is_bot: false,
    profile: { display_name: 'Ivy(김하나)', real_name: 'Ivy(김하나)' },
    ...over
  }
}

describe('toSlackMembers', () => {
  test('봇·삭제 계정·Slackbot을 제외한다', () => {
    const result = toSlackMembers([
      apiUser({ id: 'U001' }),
      apiUser({ id: 'U002', is_bot: true }),
      apiUser({ id: 'U003', deleted: true }),
      apiUser({ id: 'USLACKBOT' })
    ])
    expect(result.map((m) => m.id)).toEqual(['U001'])
  })

  test('display_name을 표시이름으로 쓴다', () => {
    const result = toSlackMembers([apiUser()])
    expect(result[0].name).toBe('Ivy(김하나)')
  })

  test('display_name이 비면 profile.real_name으로 폴백한다', () => {
    const result = toSlackMembers([
      apiUser({ profile: { display_name: '', real_name: 'hana(정소린)' } })
    ])
    expect(result[0].name).toBe('hana(정소린)')
  })

  test('profile이 통째로 없으면 real_name으로 폴백한다', () => {
    const result = toSlackMembers([apiUser({ profile: undefined, real_name: 'Ann' })])
    expect(result[0].name).toBe('Ann')
  })

  test('모든 이름 후보가 비면 핸들(name)로 폴백한다', () => {
    const result = toSlackMembers([
      apiUser({ profile: { display_name: '', real_name: '' }, real_name: '', name: 'ghost' })
    ])
    expect(result[0].name).toBe('ghost')
  })

  test('이름 후보가 공백뿐이면 건너뛰고 다음 후보를 쓴다', () => {
    const result = toSlackMembers([
      apiUser({ profile: { display_name: '   ', real_name: 'Sol(문가온)' } })
    ])
    expect(result[0].name).toBe('Sol(문가온)')
  })

  test('id가 없는 항목은 건너뛴다', () => {
    expect(toSlackMembers([apiUser({ id: undefined })])).toEqual([])
  })

  test('쓸 수 있는 이름이 하나도 없으면 건너뛴다', () => {
    const result = toSlackMembers([
      apiUser({ profile: { display_name: '', real_name: '' }, real_name: '', name: '' })
    ])
    expect(result).toEqual([])
  })
})

describe('parseSlackMembers', () => {
  test('정상 JSON을 파싱한다', () => {
    const raw = JSON.stringify({
      members: [{ id: 'U001', name: 'Ivy(김하나)' }],
      syncedAt: '2026-08-04T08:27:00.000Z'
    })
    expect(parseSlackMembers(raw).members).toHaveLength(1)
  })

  test('members가 배열이 아니면 throw한다', () => {
    expect(() => parseSlackMembers('{"members":"nope"}')).toThrow()
  })

  test('항목에 id·name이 없으면 throw한다', () => {
    expect(() => parseSlackMembers('{"members":[{"id":"U001"}]}')).toThrow()
  })

  test('syncedAt이 없으면 null이다(= 아직 동기화한 적 없음)', () => {
    expect(parseSlackMembers('{"members":[]}').syncedAt).toBeNull()
  })

  test('구버전이 남긴 빈 문자열 syncedAt도 null로 읽는다', () => {
    expect(parseSlackMembers('{"members":[],"syncedAt":""}').syncedAt).toBeNull()
  })

  test('날짜로 파싱되지 않는 syncedAt은 null로 떨어뜨린다', () => {
    expect(parseSlackMembers('{"members":[],"syncedAt":"어제"}').syncedAt).toBeNull()
  })

  test('id·name이 빈 문자열이면 throw한다', () => {
    expect(() => parseSlackMembers('{"members":[{"id":"","name":"A"}]}')).toThrow()
    expect(() => parseSlackMembers('{"members":[{"id":"U1","name":"  "}]}')).toThrow()
  })

  test('lastError를 읽어온다', () => {
    const raw = '{"members":[],"lastError":{"reason":"missing_scope","detail":"slack: missing_scope"}}'
    expect(parseSlackMembers(raw).lastError).toEqual({
      reason: 'missing_scope',
      detail: 'slack: missing_scope'
    })
  })

  test('알 수 없는 reason은 lastError를 버린다', () => {
    expect(parseSlackMembers('{"members":[],"lastError":{"reason":"바보"}}').lastError).toBeNull()
  })

  test('객체가 아니면 throw한다', () => {
    expect(() => parseSlackMembers('null')).toThrow()
  })
})

describe('classifySyncError', () => {
  test('missing_scope를 분류한다', () => {
    expect(classifySyncError('slack: missing_scope').reason).toBe('missing_scope')
  })

  test('인증 오류를 분류한다', () => {
    expect(classifySyncError('slack: invalid_auth').reason).toBe('auth')
    expect(classifySyncError('slack: account_inactive').reason).toBe('auth')
  })

  test('네트워크 오류를 분류한다', () => {
    expect(classifySyncError('Slack API 응답 실패: 503').reason).toBe('network')
    expect(classifySyncError('fetch failed').reason).toBe('network')
  })

  test('그 외는 unknown으로 두고 원문을 detail에 남긴다', () => {
    const result = classifySyncError('알 수 없는 문제')
    expect(result.reason).toBe('unknown')
    expect(result.detail).toBe('알 수 없는 문제')
  })
})

describe('visibleGuests', () => {
  test('Slack 표시이름과 겹치는 게스트를 숨긴다', () => {
    const members = [{ id: 'U001', name: 'Ivy(김하나)' }]
    expect(visibleGuests(['Ivy(김하나)', '외부 자문위원'], members)).toEqual(['외부 자문위원'])
  })

  test('대소문자가 다르면 다른 사람으로 보고 숨기지 않는다', () => {
    const members = [{ id: 'U001', name: 'Ann' }]
    expect(visibleGuests(['andy'], members)).toEqual(['andy'])
  })

  test('Slack 멤버가 없으면 게스트를 그대로 반환한다', () => {
    expect(visibleGuests(['김철수'], [])).toEqual(['김철수'])
  })
})

describe('membersInMeeting', () => {
  const members = [
    { id: 'U001', name: 'Ivy(김하나)' },
    { id: 'U002', name: 'Max(이두리)' }
  ]

  test('참석자로 선택된 멤버만 남긴다', () => {
    expect(membersInMeeting(['Ivy(김하나)'], members)).toEqual([{ id: 'U001', name: 'Ivy(김하나)' }])
  })

  test('참석자가 아니면 제외한다 — 회의에 없던 사람에게 알림이 가면 안 된다', () => {
    expect(membersInMeeting(['외부 자문위원'], members)).toEqual([])
  })

  test('대소문자가 다르면 참석자로 보지 않는다', () => {
    expect(membersInMeeting(['ivy(김하나)'], members)).toEqual([])
  })
})

describe('findMentionId', () => {
  const members = [
    { id: 'U001', name: 'Ivy(김하나)' },
    { id: 'U002', name: 'Max(이두리)' }
  ]

  test('완전 일치하면 id를 반환한다', () => {
    expect(findMentionId('Ivy(김하나)', members)).toBe('U001')
  })

  test('대소문자가 다르면 매칭하지 않는다', () => {
    expect(findMentionId('ivy(김하나)', members)).toBeNull()
  })

  test('부분 일치는 매칭하지 않는다', () => {
    expect(findMentionId('Joel', members)).toBeNull()
  })

  test('표시이름이 중복되면 매칭하지 않는다', () => {
    const dup = [
      { id: 'U001', name: 'Ann' },
      { id: 'U009', name: 'Ann' }
    ]
    expect(findMentionId('Ann', dup)).toBeNull()
  })

  test('앞뒤 공백은 무시하고 비교한다', () => {
    expect(findMentionId('  Ivy(김하나)  ', members)).toBe('U001')
  })

  test('멤버 목록이 비면 null이다', () => {
    expect(findMentionId('Ivy(김하나)', [])).toBeNull()
  })
})
