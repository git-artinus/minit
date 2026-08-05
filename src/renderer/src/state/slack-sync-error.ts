import type { SlackSyncError } from '../../../shared/types'

// 동기화 실패 사유 → 사용자 문구. 분류는 main(classifySyncError)이 하고 여기서는 매핑만 한다 —
// summary-failure.ts와 동일한 관례다(렌더러가 에러 문자열을 되짚으면 API 문구가 바뀔 때
// 조용히 안내가 사라진다).
export function slackSyncErrorText(error: SlackSyncError): string {
  switch (error.reason) {
    case 'no_token':
      return '봇 토큰이 등록되어 있지 않아 참석자를 가져오지 못했습니다.'
    case 'missing_scope':
      return 'Slack 앱에 users:read 권한을 추가한 뒤 워크스페이스에 재설치하세요. 봇 토큰 값은 바뀌지 않으므로 여기 토큰을 다시 입력할 필요는 없습니다.'
    case 'auth':
      return '봇 토큰이 더 이상 유효하지 않습니다. 워크스페이스 관리자에게 새 토큰을 받아 다시 등록하세요.'
    case 'network':
      return '네트워크 문제로 참석자를 가져오지 못했습니다. 연결을 확인한 뒤 다시 시도하세요.'
    case 'unknown':
      return `참석자 동기화에 실패했습니다: ${error.detail}`
  }
}
