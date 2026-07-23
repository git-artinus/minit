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
  | { kind: 'hidden' }

/** 회의 시작에 필요한 구성(whisper+model)이 모두 끝났는지. */
export function isEnvReady(env: EnvReport | null): boolean {
  return !!env && env.whisper && env.model
}

/**
 * SetupPanel이 보여줄 화면을 env·다운로드 진행률·오류로부터 결정하는 순수 함수.
 * 우선순위: 확인 전 > whisper 불가 > 모델 준비 완료(숨김) > 오류 > 다운로드 중 > 다운로드 필요.
 * (error·progress는 런타임에서 동시에 값을 갖지 않는다 — download() 실패 시 progress를 비운다.)
 */
export function deriveSetupState(
  env: EnvReport | null,
  progress: SetupProgress | null,
  error: string | null
): SetupView {
  if (!env) return { kind: 'checking' }
  if (!env.whisper) return { kind: 'unsupported' }
  if (env.model) return { kind: 'hidden' }
  if (error) return { kind: 'error', message: error }
  if (progress) return { kind: 'downloading', progress }
  return { kind: 'needs-model' }
}
