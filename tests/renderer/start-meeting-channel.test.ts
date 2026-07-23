import { describe, expect, test } from 'vitest'
import {
  CHANNEL_DEFAULT,
  CHANNEL_NONE,
  channelOverrideToValue,
  channelValueToOverride
} from '../../src/renderer/src/components/start-meeting-channel'

describe('channelOverrideToValue', () => {
  test('undefined → 기본값 sentinel', () => {
    expect(channelOverrideToValue(undefined)).toBe(CHANNEL_DEFAULT)
  })
  test('null → 발송 안 함 sentinel', () => {
    expect(channelOverrideToValue(null)).toBe(CHANNEL_NONE)
  })
  test('채널 id → 그대로', () => {
    expect(channelOverrideToValue('C123')).toBe('C123')
  })
})

describe('channelValueToOverride', () => {
  test('기본값 sentinel → undefined', () => {
    expect(channelValueToOverride(CHANNEL_DEFAULT)).toBeUndefined()
  })
  test('발송 안 함 sentinel → null', () => {
    expect(channelValueToOverride(CHANNEL_NONE)).toBeNull()
  })
  test('채널 id → 그대로', () => {
    expect(channelValueToOverride('C123')).toBe('C123')
  })
})
