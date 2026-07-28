import type { EnvReport } from '../../../shared/types'

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
  | { kind: 'claude-missing' }
  | { kind: 'hidden' }

/**
 * 회의 시작에 필요한 구성(whisper+model)이 모두 끝났는지.
 * claude는 일부러 제외한다 — 없어도 녹음·전사는 정상 동작하므로 회의 시작을 막지 않는다.
 */
export function isEnvReady(env: EnvReport | null): boolean {
  return !!env && env.whisper && env.model
}

/**
 * SetupPanel이 보여줄 화면을 env·다운로드 진행률·오류로부터 결정하는 순수 함수.
 * 우선순위: 확인 전 > whisper 불가 > (모델 오류 > 다운로드 중 > 다운로드 필요) > claude 미설치 > 숨김.
 * (error·progress는 런타임에서 동시에 값을 갖지 않는다 — download() 실패 시 progress를 비운다.)
 *
 * claude 미설치는 모델 준비가 끝난 뒤에만 노출한다 — 더 급한 안내를 가리지 않기 위함이다.
 */
export function deriveSetupState(
  env: EnvReport | null,
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
  if (!env.claude) return { kind: 'claude-missing' }
  return { kind: 'hidden' }
}
