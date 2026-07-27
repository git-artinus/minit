import { describe, expect, test } from 'vitest'
import { canShare, exportSavedMessage, slackBlockedReason } from '../../src/renderer/src/components/share-logic'

describe('canShare', () => {
  test('클립보드 복사는 요약이 없어도 가능하다', () => {
    expect(canShare({ target: 'clipboard', channelId: '', format: 'md' }, false)).toBe(true)
  })

  test('파일 내보내기는 요약이 없어도 가능하다', () => {
    expect(canShare({ target: 'file', channelId: '', format: 'txt' }, false)).toBe(true)
  })

  test('Slack 전송은 채널을 골라야 가능하다', () => {
    expect(canShare({ target: 'slack', channelId: '', format: 'md' }, true)).toBe(false)
    expect(canShare({ target: 'slack', channelId: 'C123', format: 'md' }, true)).toBe(true)
  })

  test('요약이 없으면 채널을 골라도 Slack 전송은 불가능하다', () => {
    expect(canShare({ target: 'slack', channelId: 'C123', format: 'md' }, false)).toBe(false)
  })
})

describe('slackBlockedReason', () => {
  test('요약이 없으면 사유를 알려준다', () => {
    expect(slackBlockedReason(false)).toBe('요약이 없어 전송할 수 없습니다. 요약을 먼저 생성하세요.')
  })

  test('요약이 있으면 사유가 없다', () => {
    expect(slackBlockedReason(true)).toBeNull()
  })
})

describe('exportSavedMessage', () => {
  test('저장 경로를 담아 알려준다', () => {
    expect(exportSavedMessage('/Users/joel/Desktop/회의.txt')).toBe('저장했습니다: /Users/joel/Desktop/회의.txt')
  })
})
