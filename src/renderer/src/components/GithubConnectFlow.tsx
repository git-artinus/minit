import { useEffect, useRef, useState } from 'react'

type Step =
  | { kind: 'starting' }
  | { kind: 'waiting'; userCode: string; verificationUri: string }
  | { kind: 'select-repo'; login: string; repos: string[] }
  | { kind: 'error'; message: string }

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// GitHub Device Flow 로그인 + 레포 선택 플로우. 온보딩 팝업(GithubPromptModal)과 설정 모달의
// "GitHub 계정" 섹션이 공유한다. 실제 폴링은 main 프로세스가 담당하며(github:startLogin),
// 이 컴포넌트는 user_code 표시 → github:login-status 이벤트 대기 → 레포 선택만 처리한다.
export function GithubConnectFlow(props: {
  onDone: (result: { login: string; repo: string | null } | null) => void
}): React.JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'starting' })
  const [selectedRepo, setSelectedRepo] = useState('')
  const [saving, setSaving] = useState(false)
  // startLogin 성공 응답당 브라우저 자동 오픈·코드 자동 복사를 1회만 수행하기 위한 가드
  // (v0.3.1 Fix 1). StrictMode에서 effect가 두 번 실행돼도(구 세션은 cancelled로 무시되고
  // 새 세션만 실제로 진행되므로) 이 인스턴스 기준 정확히 1회만 열린다.
  const autoOpenedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let off: (() => void) | undefined

    window.minuting
      .startGithubLogin()
      .then(({ userCode, verificationUri }) => {
        if (cancelled) return
        setStep({ kind: 'waiting', userCode, verificationUri })
        if (!autoOpenedRef.current) {
          autoOpenedRef.current = true
          navigator.clipboard?.writeText(userCode).catch(() => {})
          window.minuting.openExternal(verificationUri).catch(() => {})
        }
        off = window.minuting.onGithubLoginStatus((e) => {
          if (cancelled) return
          if (e.status === 'success') {
            window.minuting
              .listGithubRepos()
              .then((repos) => setStep({ kind: 'select-repo', login: e.login, repos }))
              .catch((err) => setStep({ kind: 'error', message: errMessage(err) }))
          } else if (e.status === 'expired') {
            setStep({ kind: 'error', message: '코드가 만료되었습니다. 다시 시도해 주세요.' })
          } else if (e.status === 'denied') {
            setStep({ kind: 'error', message: '로그인 요청이 거부되었습니다.' })
          } else {
            setStep({ kind: 'error', message: e.message })
          }
        })
      })
      .catch((err) => setStep({ kind: 'error', message: errMessage(err) }))

    return () => {
      cancelled = true
      off?.()
      // 언마운트 시 진행 중이던 로그인 세션을 무효화한다(리뷰 Fix 3) — 이미 완료된 세션에
      // 대한 호출은 부수효과가 없어 무해하다.
      window.minuting.cancelLogin().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회만 로그인 요청을 시작한다.
  }, [])

  const copyCode = (code: string): void => {
    navigator.clipboard?.writeText(code).catch(() => {})
  }

  // 진행 중인 로그인을 취소하고 이전 화면으로 돌아간다(리뷰 Fix 3) — waiting 단계에서도 항상
  // 빠져나갈 수 있어야 한다.
  const cancelLogin = (): void => {
    window.minuting.cancelLogin().catch(() => {})
    props.onDone(null)
  }

  const confirmRepo = async (login: string): Promise<void> => {
    setSaving(true)
    try {
      await window.minuting.updateSettings({ githubRepo: selectedRepo || null })
      props.onDone({ login, repo: selectedRepo || null })
    } catch {
      setStep({ kind: 'error', message: '저장소 설정을 저장하지 못했습니다.' })
    } finally {
      setSaving(false)
    }
  }

  if (step.kind === 'starting') {
    return (
      <>
        <p className="env-desc">GitHub 로그인 코드를 준비하는 중…</p>
        <button type="button" className="btn-ghost" onClick={cancelLogin}>
          취소
        </button>
      </>
    )
  }

  if (step.kind === 'error') {
    return (
      <>
        <p className="env-error">{step.message}</p>
        <button type="button" className="btn-ghost" onClick={() => props.onDone(null)}>
          닫기
        </button>
      </>
    )
  }

  if (step.kind === 'waiting') {
    return (
      <div className="github-connect-step">
        <p className="env-desc">
          브라우저가 열렸습니다 — 코드가 복사되어 있으니 붙여넣으세요.
        </p>
        <div className="github-user-code">{step.userCode}</div>
        <div className="setting-path-row">
          <button type="button" className="btn-ghost" onClick={() => copyCode(step.userCode)}>
            코드 복사
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => window.minuting.openExternal(step.verificationUri).catch(() => {})}
          >
            브라우저 열기
          </button>
        </div>
        <p className="github-waiting env-desc">
          <span className="rec-dot" aria-hidden="true" />
          로그인 대기 중…
        </p>
        <button type="button" className="btn-ghost" onClick={cancelLogin}>
          취소
        </button>
      </div>
    )
  }

  // select-repo
  return (
    <div className="github-connect-step">
      <p className="env-desc">@{step.login}로 로그인했습니다. 회의록을 업로드할 저장소를 선택하세요.</p>
      <select value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)}>
        <option value="">저장소를 선택하세요</option>
        {step.repos.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <div className="setting-path-row">
        <button
          type="button"
          className="btn-primary"
          disabled={!selectedRepo || saving}
          onClick={() => confirmRepo(step.login)}
        >
          선택 완료
        </button>
        <button type="button" className="btn-ghost" onClick={() => props.onDone({ login: step.login, repo: null })}>
          나중에 선택
        </button>
      </div>
    </div>
  )
}
