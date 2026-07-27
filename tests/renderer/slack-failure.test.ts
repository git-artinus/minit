import { describe, expect, test } from 'vitest'
import { slackFailureText } from '../../src/renderer/src/components/slack-failure'

describe('slackFailureText', () => {
  test('회의 제목과 사유를 한 문장으로 합친다', () => {
    expect(slackFailureText({ title: '주간 회의', reason: '네트워크 오류' })).toBe(
      '‘주간 회의’ 요약을 Slack에 보내지 못했습니다 — 네트워크 오류'
    )
  })

  test('사유가 비어 있으면 사유 부분을 생략한다', () => {
    expect(slackFailureText({ title: '주간 회의', reason: '  ' })).toBe(
      '‘주간 회의’ 요약을 Slack에 보내지 못했습니다'
    )
  })
})
