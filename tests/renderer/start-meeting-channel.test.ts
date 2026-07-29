import { describe, expect, test } from 'vitest'
import {
  CHANNEL_DEFAULT,
  CHANNEL_NONE,
  channelOverrideToValue,
  channelValueToOverride,
  defaultChannelOptionLabel
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

describe('defaultChannelOptionLabel', () => {
  test('자동 발송 켜짐 + 채널 있음 → 채널로 발송됨을 알린다', () => {
    expect(defaultChannelOptionLabel(true, 'dev-notice')).toBe('기본값 (# dev-notice로 발송)')
  })
  test('자동 발송 꺼짐 → 기본값 선택이 발송 안 함임을 알린다', () => {
    expect(defaultChannelOptionLabel(false, 'dev-notice')).toBe('기본값 (발송 안 함)')
  })
  test('채널 미설정 → 자동 발송 값과 무관하게 발송 안 함임을 알린다', () => {
    expect(defaultChannelOptionLabel(true, null)).toBe('기본값 (채널 미설정 — 발송 안 함)')
    expect(defaultChannelOptionLabel(false, null)).toBe('기본값 (채널 미설정 — 발송 안 함)')
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
