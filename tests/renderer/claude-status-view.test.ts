import { describe, expect, test } from 'vitest'
import { claudeStatusView } from '../../src/renderer/src/state/claude-status-view'
import { summaryFailureView } from '../../src/renderer/src/state/summary-failure'
import type { SummaryFailureReason } from '../../src/shared/types'

const ALL_REASONS: SummaryFailureReason[] = [
  'not_installed',
  'not_authenticated',
  'usage_limit',
  'timeout',
  'invalid_output',
  'unknown'
]

const viewOf = (reason: SummaryFailureReason): ReturnType<typeof claudeStatusView> =>
  claudeStatusView({ ok: false, failure: { reason, detail: '원문' } })

describe('claudeStatusView', () => {
  test('사용 가능하면 조치 안내가 없다', () => {
    const view = claudeStatusView({ ok: true })
    expect(view.label).toBe('사용 가능')
    expect(view.hint).toBe('')
    expect(view.showInstall).toBe(false)
    expect(view.showDetail).toBe(false)
  })

  // 설정 화면 한 줄에 들어가는 값이라 비면 상태가 사라진 것처럼 보인다.
  test('모든 사유가 label·title·hint를 채운다', () => {
    for (const reason of ALL_REASONS) {
      const view = viewOf(reason)
      expect(view.label, reason).not.toBe('')
      expect(view.title, reason).not.toBe('')
      expect(view.hint, reason).not.toBe('')
    }
  })

  // 미설치가 아닌데 설치를 권하면 사용자가 엉뚱한 곳을 고친다(로그인해야 하는데 재설치를 한다).
  test('설치 명령은 미설치일 때만 노출한다', () => {
    expect(viewOf('not_installed').showInstall).toBe(true)
    for (const reason of ALL_REASONS.filter((r) => r !== 'not_installed')) {
      expect(viewOf(reason).showInstall, reason).toBe(false)
    }
  })

  // 원인을 아는 경우엔 CLI 원문이 소음이고, 모르는 경우엔 그게 유일한 단서다.
  test('원문은 사유를 특정하지 못했을 때만 노출한다', () => {
    for (const reason of ['not_installed', 'not_authenticated', 'usage_limit'] as const) {
      expect(viewOf(reason).showDetail, reason).toBe(false)
    }
    for (const reason of ['timeout', 'invalid_output', 'unknown'] as const) {
      expect(viewOf(reason).showDetail, reason).toBe(true)
    }
  })

  test('사유마다 다른 조치를 안내한다', () => {
    expect(viewOf('not_authenticated').hint).toContain('로그인')
    expect(viewOf('usage_limit').hint).toContain('한도')
    expect(viewOf('not_installed').hint).toContain('설치')
  })

  // 온보딩은 아직 요약을 시도조차 하지 않은 시점이다. 사후 설명 문구("요약 생성에 실패했습니다")를
  // 재사용하면 하지도 않은 요약이 실패했다고 말하게 된다.
  // (usage_limit처럼 사후·사전 모두에 들어맞는 문구가 겹치는 건 정상이라 동일성은 보지 않는다.)
  test('아직 시도하지 않은 요약이 실패했다고 말하지 않는다', () => {
    for (const reason of ALL_REASONS) {
      expect(viewOf(reason).title, reason).not.toContain('요약 생성')
    }
    // 대조군 — 사후 문구는 실제로 그렇게 말한다(위 단정이 공허하지 않음을 고정한다).
    expect(summaryFailureView({ reason: 'unknown', detail: '원문' }).title).toContain('요약 생성')
  })
})
