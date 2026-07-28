import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ClaudeStatus, EnvReport } from '../../../shared/types'
import { deriveSetupState, isEnvReady, type SetupProgress, type SetupView } from './setup-logic'

export interface SetupApi {
  view: SetupView
  /** 환경 검사 결과 원본 — 설정 화면도 이걸 쓴다(각자 조회하면 두 화면이 서로 모순된다). */
  env: EnvReport | null
  /** 환경 검사 자체가 실패한 경우. 삼키면 "확인 중…"이 영구 표시되거나 낡은 값이 신뢰된다. */
  envError: string | null
  rechecking: boolean
  /** claude 사전 확인 결과(#8). null=아직 확인 중. 설치 여부가 아니라 실제 실행 결과다. */
  claude: ClaudeStatus | null
  /** 확인 호출 자체가 실패한 경우(IPC 오류 등) — "못 쓴다"는 판정을 받은 것과는 다르다. */
  claudeError: string | null
  claudeChecking: boolean
  /** claude를 다시 실행해 상태를 새로 확인한다(캐시 무시). */
  recheckClaude: () => Promise<void>
  ready: boolean
  minimized: boolean
  setMinimized: (m: boolean) => void
  /** 트레이 등 외부에서 패널을 다시 눈에 띄게 만들 때 사용한다(최소화 해제). */
  expand: () => void
  /** whisper 불가 카드의 "다시 확인" 버튼. */
  recheck: () => Promise<void>
  /** 모델 다운로드 시작(동의 버튼)·실패 후 재시도 겸용. */
  download: () => Promise<void>
}

const Ctx = createContext<SetupApi | null>(null)

function useSetupInternal(): SetupApi {
  const [env, setEnv] = useState<EnvReport | null>(null)
  const [progress, setProgress] = useState<SetupProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [envError, setEnvError] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const [claude, setClaude] = useState<ClaudeStatus | null>(null)
  const [claudeError, setClaudeError] = useState<string | null>(null)
  const [claudeChecking, setClaudeChecking] = useState(false)
  const [minimized, setMinimized] = useState(false)

  const recheck = useCallback(async (): Promise<void> => {
    setRechecking(true)
    setEnvError(null)
    try {
      setEnv(await window.minuting.checkEnv())
    } catch (e) {
      // catch가 없으면 렌더러에 unhandled rejection이 남고 패널이 '확인 중'에 고착된다.
      setEnvError(e instanceof Error ? e.message : String(e))
    } finally {
      setRechecking(false)
    }
  }, [])

  const checkClaude = useCallback(async (force: boolean): Promise<void> => {
    setClaudeChecking(true)
    setClaudeError(null)
    try {
      setClaude(await window.minuting.checkClaudeStatus(force))
    } catch (e) {
      setClaudeError(e instanceof Error ? e.message : String(e))
    } finally {
      setClaudeChecking(false)
    }
  }, [])

  const recheckClaude = useCallback((): Promise<void> => checkClaude(true), [checkClaude])

  useEffect(() => {
    recheck()
    // 실행마다 1회. main이 결과를 캐시하므로 이 호출이 곧 그 1회이고, 이후 화면들은 캐시를 읽는다.
    // 요약 실패 시점이 아니라 지금 알려주는 게 이 검사의 존재 이유다(#8) — 회의를 마치고 나서야
    // "로그인이 안 돼 있었다"를 알면 그 회의의 요약은 이미 못 만든 뒤다.
    checkClaude(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회만 확인한다(recheck·checkClaude는 useCallback으로 안정적이라 재실행되지 않지만 명시적으로 []로 의도를 남긴다).
  }, [])

  // 확인은 위에서 1회뿐이고 [다시 확인]은 사용자가 눌러야 한다. 이 구독이 없으면 회의 요약이
  // 로그인 문제로 실패해 main이 사실을 알게 돼도 화면은 앱 실행 시점의 값에 머문다.
  useEffect(() => {
    return window.minuting.onClaudeStatus(setClaude)
  }, [])

  const download = useCallback(async (): Promise<void> => {
    setError(null)
    const off = window.minuting.onModelProgress((r, t) => setProgress({ received: r, total: t }))
    try {
      await window.minuting.ensureModel()
      await recheck()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress(null)
    } finally {
      off()
    }
  }, [recheck])

  const expand = useCallback((): void => setMinimized(false), [])

  return {
    view: deriveSetupState(env, claude, progress, error),
    env,
    envError,
    rechecking,
    claude,
    claudeError,
    claudeChecking,
    recheckClaude,
    ready: isEnvReady(env),
    minimized,
    setMinimized,
    expand,
    recheck,
    download
  }
}

export function SetupProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useSetupInternal()}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- MeetingsProvider와 동일한 패턴(컨텍스트+훅을 한 파일에서 export)
export function useSetup(): SetupApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('SetupProvider 밖에서 useSetup을 호출했다')
  return v
}
