import type { ExportFormat } from '../../../shared/share-format'

export type ShareTarget = 'clipboard' | 'slack' | 'file'

export interface ShareSelection {
  target: ShareTarget
  channelId: string
  format: ExportFormat
}

// 요약이 없는 회의(전사만 저장)는 Slack 발송을 건너뛰는 자동 발송 규칙(slack.ts)과 맞춘다.
// 복사·내보내기는 트랜스크립트만으로도 쓸모가 있어 허용한다.
export function canShare(sel: ShareSelection, hasSummary: boolean): boolean {
  if (sel.target !== 'slack') return true
  return hasSummary && sel.channelId !== ''
}

export function slackBlockedReason(hasSummary: boolean): string | null {
  return hasSummary ? null : '요약이 없어 전송할 수 없습니다. 요약을 먼저 생성하세요.'
}

export function exportSavedMessage(filePath: string): string {
  return `저장했습니다: ${filePath}`
}
