import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { EnvReport } from '../../../shared/types'
import { deriveSetupState, isEnvReady, type SetupProgress, type SetupView } from './setup-logic'

export interface SetupApi {
  view: SetupView
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
  const [minimized, setMinimized] = useState(false)

  const recheck = useCallback((): Promise<void> => window.minuting.checkEnv().then(setEnv), [])

  useEffect(() => {
    recheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회만 확인한다(recheck는 useCallback으로 안정적이라 재실행되지 않지만 명시적으로 []로 의도를 남긴다).
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
    view: deriveSetupState(env, progress, error),
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
