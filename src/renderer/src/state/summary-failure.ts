import type { SummaryFailure } from '../../../shared/types'

export interface SummaryFailureView {
  title: string
  hint: string
}

const UNKNOWN_VIEW: SummaryFailureView = {
  title: '요약 생성에 실패했습니다',
  hint: '아래 내용을 확인한 뒤 다시 시도하세요.'
}

/**
 * 실패 사유 → 사용자 문구. 분류 자체는 main이 종료 코드·시그널·stdout/stderr로 끝내고,
 * 렌더러는 매핑만 한다(문자열 정규식 매칭은 CLI 버전·언어에 취약해 폐기했다).
 *
 * 재시도 가능 여부는 내보내지 않는다. 예전에는 not_installed에서 버튼을 잠갔는데, 잠그면
 * 실패 상태를 지울 방법이 사라져(초기화는 재시도 시점에만 일어난다) CLI를 설치하고 재검사해도
 * 앱 재시작 전까지 버튼이 죽었다. 미설치 재시도는 즉시·정확히 실패하므로 막을 이유가 없다.
 */
export function summaryFailureView(failure: SummaryFailure): SummaryFailureView {
  switch (failure.reason) {
    case 'not_installed':
      return {
        title: 'Claude CLI가 설치되어 있지 않습니다',
        hint: '설치한 뒤 다시 시도하세요. 설정 → Claude에서 상태를 확인할 수 있습니다.'
      }
    case 'not_authenticated':
      return {
        title: 'Claude에 로그인되어 있지 않습니다',
        hint: '터미널에서 claude 를 실행해 로그인한 뒤 다시 시도하세요.'
      }
    case 'usage_limit':
      return {
        title: 'Claude 사용량 한도에 도달했습니다',
        hint: '한도가 초기화된 뒤 다시 시도하세요.'
      }
    case 'timeout':
      return {
        title: '요약 생성이 제한 시간을 초과했습니다',
        hint: '회의가 길면 시간이 더 걸릴 수 있습니다. 다시 시도해 보세요.'
      }
    case 'invalid_output':
      return {
        title: 'Claude가 예상한 형식으로 응답하지 않았습니다',
        hint: '다시 시도하면 해결되는 경우가 많습니다.'
      }
    case 'unknown':
      return UNKNOWN_VIEW
    default:
      // 사유를 추가하면 여기서 컴파일 에러가 난다 — 문구 매핑 누락을 막는다(런타임 폴백은 유지).
      failure.reason satisfies never
      return UNKNOWN_VIEW
  }
}
