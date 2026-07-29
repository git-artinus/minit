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

// "기본값" 옵션의 표시 문구 — 설정의 유효 기본값(자동 발송 여부 × 채널 유무)을 그대로 드러낸다.
// 자동 발송이 꺼져 있으면 기본값 선택 = 발송 안 함이라는 사실을 여기서 알려줘야, 사용자가
// 발송될 거라 믿고 회의를 시작하는 오해를 막는다.
export function defaultChannelOptionLabel(autoSend: boolean, channelName: string | null): string {
  if (channelName === null) return '기본값 (채널 미설정 — 발송 안 함)'
  if (!autoSend) return '기본값 (발송 안 함)'
  return `기본값 (# ${channelName}로 발송)`
}
