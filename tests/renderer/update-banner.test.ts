import { describe, expect, test } from 'vitest'
import {
  shouldShowUpdateBanner,
  updateVersionKey
} from '../../src/renderer/src/state/update-banner'
import type { UpdateCheckResult } from '../../src/shared/types'

const v = (version: string): UpdateCheckResult => ({ available: true, version })

describe('shouldShowUpdateBanner', () => {
  test('감지 결과가 없으면 숨긴다', () => {
    expect(shouldShowUpdateBanner(null, null)).toBe(false)
  })

  test('새 버전이 없으면 숨긴다', () => {
    expect(shouldShowUpdateBanner({ available: false }, null)).toBe(false)
  })

  test('새 버전이 있고 미룬 적 없으면 보여준다', () => {
    expect(shouldShowUpdateBanner(v('1.0.0'), null)).toBe(true)
  })

  test('미룬 버전은 숨긴다', () => {
    expect(shouldShowUpdateBanner(v('1.0.0'), '1.0.0')).toBe(false)
  })

  // boolean 래치였을 때의 실제 버그 — 한 번 미루면 이후 어떤 새 버전도 배너가 뜨지 않았다.
  test('미룬 뒤 새 버전이 오면 다시 보여준다', () => {
    expect(shouldShowUpdateBanner(v('1.1.0'), '1.0.0')).toBe(true)
  })

  // 버전을 모르는 결과도 미룰 수 있어야 한다(undefined면 비교가 늘 어긋난다).
  test('버전이 없는 결과도 미룰 수 있다', () => {
    const unknown: UpdateCheckResult = { available: true }
    expect(shouldShowUpdateBanner(unknown, null)).toBe(true)
    expect(shouldShowUpdateBanner(unknown, updateVersionKey(unknown))).toBe(false)
  })
})
