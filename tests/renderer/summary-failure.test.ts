import { describe, expect, test } from 'vitest'
import { summaryFailureView } from '../../src/renderer/src/state/summary-failure'
import type { SummaryFailure, SummaryFailureReason } from '../../src/shared/types'

const failure = (reason: SummaryFailureReason, detail = '원문'): SummaryFailure => ({
  reason,
  detail
})

describe('summaryFailureView', () => {
  test('미설치는 재시도해도 소용없다', () => {
    const v = summaryFailureView(failure('not_installed'))
    expect(v.canRetry).toBe(false)
    expect(v.title).toContain('설치')
  })

  test('미인증은 로그인 방법을 알려주고 재시도를 허용한다', () => {
    const v = summaryFailureView(failure('not_authenticated'))
    expect(v.canRetry).toBe(true)
    expect(v.hint).toContain('claude')
  })

  test('사용량 한도는 재시도 가능', () => {
    expect(summaryFailureView(failure('usage_limit')).canRetry).toBe(true)
  })

  test('타임아웃은 긴 회의라는 맥락을 알려준다', () => {
    const v = summaryFailureView(failure('timeout'))
    expect(v.canRetry).toBe(true)
    expect(v.hint).toContain('회의가 길면')
  })

  test('형식 오류는 재시도로 풀리는 경우가 많다고 안내한다', () => {
    expect(summaryFailureView(failure('invalid_output')).canRetry).toBe(true)
  })

  test('unknown도 재시도를 막지 않는다', () => {
    const v = summaryFailureView(failure('unknown'))
    expect(v.canRetry).toBe(true)
    expect(v.title).not.toBe('')
  })

  test('모든 사유가 빈 문구 없이 매핑된다', () => {
    const reasons: SummaryFailureReason[] = [
      'not_installed',
      'not_authenticated',
      'usage_limit',
      'timeout',
      'invalid_output',
      'unknown'
    ]
    for (const r of reasons) {
      const v = summaryFailureView(failure(r))
      expect(v.title.length).toBeGreaterThan(0)
      expect(v.hint.length).toBeGreaterThan(0)
    }
  })
})
