import type { ClaudeStatus, EnvReport, SummaryFailure } from '../../../shared/types'

export interface SetupProgress {
  received: number
  total: number
}

export type SetupView =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  | { kind: 'needs-model' }
  | { kind: 'downloading'; progress: SetupProgress }
  | { kind: 'error'; message: string }
  // 미설치·미로그인·사용량 소진을 한 종류로 묶고 사유는 failure가 들고 간다 — 사유가 늘 때마다
  // kind를 늘리면 패널이 kind마다 분기해야 한다(문구 매핑은 claude-status-view가 전담한다).
  | { kind: 'claude-unavailable'; failure: SummaryFailure }
  | { kind: 'hidden' }

/**
 * 설치 출력에서 화면에 유지할 줄 수. 설치 스크립트는 진행률을 줄 단위로 갱신해 수천 줄이
 * 나올 수 있는데, 전량을 상태에 쌓으면 메모리와 렌더 비용이 계속 커진다.
 * 전문은 ~/.minit/install-claude.log에 남으므로 화면은 끝부분만 있으면 된다.
 */
export const INSTALL_LOG_MAX_LINES = 200

/**
 * 글자 수 상한. 줄 수만으로는 부족하다 — 진행률을 캐리지 리턴으로 갱신하는 프로그램의 출력은
 * 아무리 길어져도 한 줄이라 줄 수 상한에 걸리지 않고, 화면에 수 MB짜리 한 줄이 쌓인다.
 * 200줄이 각각 상당히 길어도 들어가는 크기로 잡는다.
 */
export const INSTALL_LOG_MAX_CHARS = 40_000

/**
 * 새 청크를 이어 붙이고 상한을 넘으면 오래된 쪽을 버린다 — 실패 원인은 보통 끝에 있다.
 * 줄 수와 글자 수 두 상한을 모두 적용한다(둘 중 하나만으로는 한쪽 형태의 출력을 놓친다).
 */
export function appendInstallLog(prev: string, chunk: string): string {
  const joined = prev + chunk
  const capped =
    joined.length <= INSTALL_LOG_MAX_CHARS ? joined : joined.slice(-INSTALL_LOG_MAX_CHARS)
  const lines = capped.split('\n')
  return lines.length <= INSTALL_LOG_MAX_LINES
    ? capped
    : lines.slice(-INSTALL_LOG_MAX_LINES).join('\n')
}

/**
 * 회의 시작에 필요한 구성(whisper+model)이 모두 끝났는지.
 * claude는 일부러 제외한다 — 없어도 녹음·전사는 정상 동작하므로 회의 시작을 막지 않는다.
 */
export function isEnvReady(env: EnvReport | null): boolean {
  return !!env && env.whisper && env.model
}

/**
 * SetupPanel이 보여줄 화면을 env·claude 상태·다운로드 진행률·오류로부터 결정하는 순수 함수.
 * 우선순위: 확인 전 > whisper 불가 > (모델 오류 > 다운로드 중 > 다운로드 필요) > claude 사용 불가 > 숨김.
 * (error·progress는 런타임에서 동시에 값을 갖지 않는다 — download() 실패 시 progress를 비운다.)
 *
 * claude 안내는 모델 준비가 끝난 뒤에만 노출한다 — 더 급한 안내를 가리지 않기 위함이다.
 * claude=null(아직 확인 중)이면 아무 말도 하지 않는다. 비차단 기능이라 "확인 중" 카드를 띄우면
 * 앱을 켤 때마다 아무 조치도 필요 없는 안내가 몇 초씩 깜빡인다.
 *
 * undetermined도 카드를 띄우지 않는다. 사용자가 할 수 있는 일이 없는데 경고만 남기 때문이다 —
 * 콜드 스타트가 느려 프로브가 한 번 타임아웃하면 세션 내내 거짓 경고가 붙는다.
 * 확인 실패 사실은 설정 화면이 재시도 버튼과 함께 표시한다.
 */
export function deriveSetupState(
  env: EnvReport | null,
  claude: ClaudeStatus | null,
  progress: SetupProgress | null,
  error: string | null
): SetupView {
  if (!env) return { kind: 'checking' }
  if (!env.whisper) return { kind: 'unsupported' }
  if (!env.model) {
    if (error) return { kind: 'error', message: error }
    if (progress) return { kind: 'downloading', progress }
    return { kind: 'needs-model' }
  }
  if (claude?.kind === 'unavailable') return { kind: 'claude-unavailable', failure: claude.failure }
  return { kind: 'hidden' }
}
