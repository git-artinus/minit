// 회의시작 모달 채널 <select>의 문자열 value ↔ MeetingMeta.slackChannelId(3-상태) 변환.
// select는 문자열만 다루므로 "기본값 사용(undefined)"·"발송 안 함(null)"을 sentinel 문자열로 표현한다.
export const CHANNEL_DEFAULT = '__default__'
export const CHANNEL_NONE = '__none__'

export function channelOverrideToValue(override: string | null | undefined): string {
  if (override === undefined) return CHANNEL_DEFAULT
  if (override === null) return CHANNEL_NONE
  return override
}

export function channelValueToOverride(value: string): string | null | undefined {
  if (value === CHANNEL_DEFAULT) return undefined
  if (value === CHANNEL_NONE) return null
  return value
}
