import { describe, expect, test } from 'vitest'
import { claudeStatusView } from '../../src/renderer/src/state/claude-status-view'
import { summaryFailureView } from '../../src/renderer/src/state/summary-failure'
import type { ClaudeStatus, SummaryFailureReason } from '../../src/shared/types'

const ALL_REASONS: SummaryFailureReason[] = [
  'not_installed',
  'not_authenticated',
  'usage_limit',
  'timeout',
  'invalid_output',
  'unknown'
]

// 문구는 kind가 아니라 reason이 정한다(kind는 캐시·카드 노출을 가른다). unavailable로 훑으면
// 모든 사유의 문구를 덮을 수 있다.
const viewOf = (reason: SummaryFailureReason): ReturnType<typeof claudeStatusView> =>
  claudeStatusView({ kind: 'unavailable', failure: { reason, detail: '원문' } })

describe('claudeStatusView', () => {
  test('사용 가능하면 조치 안내도 원문도 없다', () => {
    const view = claudeStatusView({ kind: 'available' })
    expect(view.label).toBe('사용 가능')
    expect(view.hint).toBeNull()
    expect(view.showInstall).toBe(false)
    expect(view.detail).toBeNull()
  })

  test('같은 사유면 kind가 달라도 문구가 같다', () => {
    const failure = { reason: 'timeout' as const, detail: '원문' }
    expect(claudeStatusView({ kind: 'undetermined', failure })).toEqual(
      claudeStatusView({ kind: 'unavailable', failure })
    )
  })

  // 설정 화면 한 줄에 들어가는 값이라 비면 상태가 사라진 것처럼 보인다.
  test('모든 사유가 label·title·hint를 채운다', () => {
    for (const reason of ALL_REASONS) {
      const view = viewOf(reason)
      expect(view.label, reason).not.toBe('')
      expect(view.title, reason).not.toBe('')
      expect(view.hint, reason).toBeTruthy()
    }
  })

  // 사유가 다르면 해야 할 일도 다르다. 문구가 뭉개지면 로그인이 필요한 사용자가
  // "Claude CLI가 필요합니다" 제목 아래에서 설치를 시도한다.
  test('조치가 다른 세 사유는 label·title이 서로 다르다', () => {
    const distinct = ['not_installed', 'not_authenticated', 'usage_limit'] as const
    expect(new Set(distinct.map((r) => viewOf(r).label)).size).toBe(3)
    expect(new Set(distinct.map((r) => viewOf(r).title)).size).toBe(3)
  })

  // 미설치가 아닌데 설치를 권하면 사용자가 엉뚱한 곳을 고친다(로그인해야 하는데 재설치를 한다).
  test('설치 명령은 미설치일 때만 노출한다', () => {
    expect(viewOf('not_installed').showInstall).toBe(true)
    for (const reason of ALL_REASONS.filter((r) => r !== 'not_installed')) {
      expect(viewOf(reason).showInstall, reason).toBe(false)
    }
  })

  // 원인을 아는 경우엔 CLI 원문이 소음이고, 모르는 경우엔 그게 유일한 단서다.
  test('원문은 사유를 특정하지 못했을 때만 싣는다', () => {
    for (const reason of ['not_installed', 'not_authenticated', 'usage_limit'] as const) {
      expect(viewOf(reason).detail, reason).toBeNull()
    }
    for (const reason of ['timeout', 'invalid_output', 'unknown'] as const) {
      expect(viewOf(reason).detail, reason).toBe('원문')
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

  test('알 수 없는 사유가 들어와도 문구가 비지 않는다', () => {
    const bogus = { kind: 'unavailable', failure: { reason: 'nope', detail: '원문' } } as unknown
    const view = claudeStatusView(bogus as ClaudeStatus)
    expect(view.label).toBe('확인 실패')
    expect(view.detail).toBe('원문')
  })
})
