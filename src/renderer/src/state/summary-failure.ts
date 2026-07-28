import type { SummaryFailure } from '../../../shared/types'

export interface SummaryFailureView {
  title: string
  hint: string
  /** 다시 시도해서 풀릴 여지가 있는가. 미설치처럼 앱 밖에서 조치해야 하면 false. */
  canRetry: boolean
}

/**
 * 실패 사유 → 사용자 문구. 분류 자체는 main이 exit code·stdout·stderr로 끝내고,
 * 렌더러는 매핑만 한다(문자열 정규식 매칭은 CLI 버전·언어에 취약해 폐기했다).
 */
export function summaryFailureView(failure: SummaryFailure): SummaryFailureView {
  switch (failure.reason) {
    case 'not_installed':
      return {
        title: 'Claude CLI가 설치되어 있지 않습니다',
        hint: '설치한 뒤 다시 시도하세요. 설정 → Claude에서 상태를 확인할 수 있습니다.',
        canRetry: false
      }
    case 'not_authenticated':
      return {
        title: 'Claude에 로그인되어 있지 않습니다',
        hint: '터미널에서 claude 를 실행해 로그인한 뒤 다시 시도하세요.',
        canRetry: true
      }
    case 'usage_limit':
      return {
        title: 'Claude 사용량 한도에 도달했습니다',
        hint: '한도가 초기화된 뒤 다시 시도하세요.',
        canRetry: true
      }
    case 'timeout':
      return {
        title: '요약 생성이 제한 시간을 초과했습니다',
        hint: '회의가 길면 시간이 더 걸릴 수 있습니다. 다시 시도해 보세요.',
        canRetry: true
      }
    case 'invalid_output':
      return {
        title: 'Claude가 예상한 형식으로 응답하지 않았습니다',
        hint: '다시 시도하면 해결되는 경우가 많습니다.',
        canRetry: true
      }
    default:
      return {
        title: '요약 생성에 실패했습니다',
        hint: '아래 내용을 확인한 뒤 다시 시도하세요.',
        canRetry: true
      }
  }
}
