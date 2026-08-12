import { useSetup } from '../state/setup'

/**
 * 인앱 Claude 로그인. `claude auth login`이 루프백 콜백 서버를 띄우고 브라우저 OAuth 동의를
 * 받으므로 사용자가 터미널을 열 필요가 없다. 온보딩 패널(SetupPanel)과 설정 모달이 공유한다.
 *
 * 상태 문구와 동작 버튼을 따로 내보내는 이유는 둘이 놓일 자리가 다르기 때문이다 — 버튼은
 * [다시 확인]과 같은 행 오른쪽 끝에 서고, 문구는 그 위 본문에 줄로 놓인다. 한 덩어리로 묶으면
 * 행 안에 문단이 들어가 정렬이 깨진다.
 *
 * 문구를 claudeStatusView에서 받지 않는다 — '대기 중'·'미완료'는 CLI의 판정이 아니라 이
 * 세션의 진행 상황이고, 두 소스를 섞으면 한쪽이 만들지 않는 상태를 화면이 기대하게 된다.
 */
export function ClaudeLoginStatus({
  showLogin
}: {
  showLogin: boolean
}): React.JSX.Element | null {
  const { claudeLoginPhase, claudeLoginError } = useSetup()

  // 진행 중 세션은 사유와 무관하게 계속 알린다 — 사용자가 시작한 작업을 화면에서 지우지 않는다.
  if (claudeLoginPhase === 'waiting') {
    return (
      <p className="claude-waiting env-desc">
        <span className="rec-dot" aria-hidden="true" />
        브라우저에서 로그인을 완료해 주세요.
      </p>
    )
  }
  if (!showLogin) return null
  if (claudeLoginPhase === 'incomplete') {
    return <p className="env-error">로그인이 완료되지 않았습니다. 다시 시도해 주세요.</p>
  }
  if (claudeLoginPhase === 'error' && claudeLoginError !== null) {
    return <p className="env-error">로그인 실패: {claudeLoginError}</p>
  }
  return null
}

/**
 * [다시 확인]과 같은 행에 놓는 주 동작. 대기 중에는 같은 자리가 [취소]로 바뀐다.
 *
 * 언마운트에서 로그인을 취소하지 않는다(ClaudeInstallAction과 같은 이유) — 설정 모달을 닫는
 * 것만으로 브라우저에서 진행 중인 OAuth가 끊기면, 사용자는 브라우저에서 성공 화면을 보는데
 * 자격증명은 저장되지 않는다. 세션 상태는 SetupProvider가 들고 있어서, 화면을 닫아도
 * 결과가 도착해 상태가 갱신된다.
 */
export function ClaudeLoginAction({
  showLogin
}: {
  showLogin: boolean
}): React.JSX.Element | null {
  const { claudeLoginPhase, startClaudeLogin, cancelClaudeLogin } = useSetup()
  const waiting = claudeLoginPhase === 'waiting'

  if (!showLogin && !waiting) return null

  return waiting ? (
    <button
      type="button"
      className="btn-ghost claude-action"
      onClick={() => void cancelClaudeLogin()}
    >
      취소
    </button>
  ) : (
    <button
      type="button"
      className="btn-primary claude-action"
      onClick={() => void startClaudeLogin()}
    >
      Claude 로그인
    </button>
  )
}
