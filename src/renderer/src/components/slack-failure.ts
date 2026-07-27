import type { SlackSendFailure } from '../../../shared/types'

export function slackFailureText(failure: SlackSendFailure): string {
  const head = `‘${failure.title}’ 요약을 Slack에 보내지 못했습니다`
  return failure.reason.trim() === '' ? head : `${head} — ${failure.reason.trim()}`
}
