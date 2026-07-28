import { describe, expect, test } from 'vitest'
import { summaryFailureView } from '../../src/renderer/src/state/summary-failure'
import type { SummaryFailure, SummaryFailureReason } from '../../src/shared/types'

const failure = (reason: SummaryFailureReason, detail = '원문'): SummaryFailure => ({
  reason,
  detail
})

const ALL_REASONS: SummaryFailureReason[] = [
  'not_installed',
  'not_authenticated',
  'usage_limit',
  'timeout',
  'invalid_output',
  'unknown'
]

describe('summaryFailureView', () => {
  test('미설치는 설치 안내와 설정 경로를 알려준다', () => {
    const v = summaryFailureView(failure('not_installed'))
    expect(v.title).toContain('설치')
    expect(v.hint).toContain('설정')
  })

  test('미인증은 로그인 방법을 알려준다', () => {
    expect(summaryFailureView(failure('not_authenticated')).hint).toContain('claude')
  })

  test('사용량 한도는 한도 초기화를 안내한다', () => {
    expect(summaryFailureView(failure('usage_limit')).hint).toContain('한도')
  })

  test('타임아웃은 긴 회의라는 맥락을 알려준다', () => {
    expect(summaryFailureView(failure('timeout')).hint).toContain('회의가 길면')
  })

  test('형식 오류는 재시도로 풀리는 경우가 많다고 안내한다', () => {
    expect(summaryFailureView(failure('invalid_output')).hint).toContain('다시 시도')
  })

  test('unknown은 detail을 확인하도록 안내한다', () => {
    const v = summaryFailureView(failure('unknown'))
    expect(v.title).not.toBe('')
    expect(v.hint).toContain('확인')
  })

  test('모든 사유가 빈 문구 없이 매핑된다', () => {
    for (const r of ALL_REASONS) {
      const v = summaryFailureView(failure(r))
      expect(v.title.length).toBeGreaterThan(0)
      expect(v.hint.length).toBeGreaterThan(0)
    }
  })

  // 사유마다 다른 문구가 나와야 한다 — 전부 default로 떨어지면 이 테스트가 잡는다.
  test('사유별 제목이 서로 구별된다', () => {
    const titles = ALL_REASONS.map((r) => summaryFailureView(failure(r)).title)
    expect(new Set(titles).size).toBe(ALL_REASONS.length)
  })
})
