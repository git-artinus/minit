import type { ClaudeStatus, SummaryFailure } from '../../../shared/types'

export interface ClaudeStatusView {
  /** 설정 화면 Claude 행에 한 마디로 붙는 상태. */
  label: string
  /** 온보딩 패널 제목. */
  title: string
  /** 사용자가 무엇을 해야 하는지. 할 일이 없으면 null. */
  hint: string | null
  /** 설치 명령·설치 문서를 함께 보여줄지. 미설치가 아닌데 설치를 권하면 엉뚱한 곳을 고치게 된다. */
  showInstall: boolean
  /**
   * 함께 보여줄 CLI 원문. 사유를 특정한 경우엔 소음일 뿐이라 null이다. 플래그가 아니라 값을
   * 실어 두는 이유는 소비자가 모델로 되돌아가지 않게 하기 위함이다 — 플래그와 텍스트가
   * 따로 놀면 "보여준다고 해놓고 빈 줄"이 표현 가능해진다.
   */
  detail: string | null
}

const AVAILABLE: ClaudeStatusView = {
  label: '사용 가능',
  title: 'Claude를 사용할 수 있습니다',
  hint: null,
  showInstall: false,
  detail: null
}

/**
 * 상태 → 사용자 문구. 판정은 main이 실제 실행 결과로 끝내고 렌더러는 매핑만 한다
 * (summary-failure.ts와 같은 원칙).
 *
 * kind는 동작을(캐시할지·안내 카드를 띄울지) 가르고 문구는 reason이 정한다. 그래서 여기서는
 * available만 따로 보고 나머지 둘은 같은 표를 탄다 — unavailable/undetermined의 차이는
 * 이미 deriveSetupState가 카드 노출 여부로 반영한다.
 *
 * summaryFailureView와 사유 집합은 같지만 문구를 공유하지 않는다. 저쪽은 이미 벌어진 실패를
 * 사후에 설명하고("요약 생성에 실패했습니다"), 이쪽은 아직 요약을 시도하지 않은 시점의 상태를
 * 알린다 — 같은 문구를 쓰면 온보딩에서 하지도 않은 요약이 실패했다고 말하게 된다.
 */
export function claudeStatusView(status: ClaudeStatus): ClaudeStatusView {
  return status.kind === 'available' ? AVAILABLE : viewForFailure(status.failure)
}

function checkFailed(hint: string, detail: string): ClaudeStatusView {
  return {
    label: '확인 실패',
    title: 'Claude 상태를 확인하지 못했습니다',
    hint,
    showInstall: false,
    // 사유를 특정하지 못했으니 원문이 유일한 단서다. 이걸 빼면 사용자가 볼 방법이 없다.
    detail
  }
}

function viewForFailure(failure: SummaryFailure): ClaudeStatusView {
  switch (failure.reason) {
    case 'not_installed':
      return {
        label: '미설치',
        title: '요약 기능을 쓰려면 Claude CLI가 필요합니다',
        hint: '터미널에서 아래 명령으로 설치한 뒤 [다시 확인]을 누르세요.',
        showInstall: true,
        detail: null
      }
    case 'not_authenticated':
      return {
        label: '로그인 필요',
        title: 'Claude CLI에 로그인되어 있지 않습니다',
        // 로그인은 대화형 CLI 절차라 앱이 대신 진행할 수 없다 — 안내 + 재확인이 최선이다.
        hint: '터미널에서 claude 를 실행해 로그인한 뒤 [다시 확인]을 누르세요.',
        showInstall: false,
        detail: null
      }
    case 'usage_limit':
      return {
        label: '사용량 소진',
        title: 'Claude 사용량 한도에 도달했습니다',
        hint: '한도가 초기화되면 요약이 다시 동작합니다. 녹음과 받아쓰기는 영향을 받지 않습니다.',
        showInstall: false,
        detail: null
      }
    case 'timeout':
      return checkFailed(
        '응답이 제한 시간을 넘었습니다. 잠시 후 [다시 확인]을 누르세요.',
        failure.detail
      )
    // 프로브는 JSON을 파싱하지 않으므로 invalid_output이 나올 일이 없다. 그래도 사유 집합을
    // 공유하는 이상 타입상 도달 가능하고, 여기서 빠뜨리면 아래 satisfies never가 깨진다.
    case 'invalid_output':
    case 'unknown':
      return checkFailed('아래 내용을 확인한 뒤 [다시 확인]을 누르세요.', failure.detail)
    default:
      failure.reason satisfies never
      return checkFailed('아래 내용을 확인한 뒤 [다시 확인]을 누르세요.', failure.detail)
  }
}
