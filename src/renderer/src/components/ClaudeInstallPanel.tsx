import { useEffect, useRef, useState } from 'react'
import { useSetup } from '../state/setup'
import { claudeInstallCommand, CLAUDE_DOCS_URL } from '../../../shared/claude-cli'

/**
 * 인앱 Claude CLI 설치. 공식 문서가 권장하는 native installer를 앱이 실행하고 출력을 그대로
 * 보여준다 — 원격 스크립트를 받아 실행하는 일이므로 무엇이 돌고 있는지 숨기지 않는다.
 *
 * 명령을 버튼과 함께 계속 보여주는 이유는, 버튼을 쓰지 않고 직접 실행하려는 사용자에게
 * 그 선택을 남겨두기 위함이다.
 */
export function ClaudeInstallCommand(): React.JSX.Element {
  const { claudeInstallPhase } = useSetup()
  const [label, setLabel] = useState('복사')
  const revertRef = useRef<number | null>(null)
  // 플랫폼은 preload가 넘긴다 — 렌더러에는 process가 없다.
  const installCommand = claudeInstallCommand(window.minuting.platform)

  useEffect(() => {
    return () => {
      if (revertRef.current !== null) window.clearTimeout(revertRef.current)
    }
  }, [])

  // 렌더러가 file:// 오리진으로 로드될 때 navigator.clipboard가 막히므로 메인을 경유한다
  // (공유 기능이 writeClipboard를 도입한 것과 같은 이유).
  const copy = (): void => {
    window.minuting.writeClipboard(installCommand).then(
      () => {
        setLabel('복사됨')
        // 되돌리지 않으면 '복사됨'이 고정돼 두 번째 복사가 됐는지 알 수 없다.
        revertRef.current = window.setTimeout(() => setLabel('복사'), 2000)
      },
      () => setLabel('복사 실패')
    )
  }

  return (
    <div className="setting-path-row">
      {/* .setting-path와 달리 ltr + 가로 스크롤이다 — 명령은 앞쪽('curl'·'irm')이 잘리면
          무슨 명령인지 알 수 없다(저장 경로는 뒤쪽이 중요해 반대라, 클래스를 공유할 수 없다). */}
      <code className="setting-command" title={installCommand}>
        {installCommand}
      </code>
      <button
        type="button"
        className="btn-ghost"
        onClick={copy}
        disabled={claudeInstallPhase === 'running'}
      >
        {label}
      </button>
    </div>
  )
}

/**
 * 진행 출력과 실패 사유. 동작 버튼과 따로 내보내는 이유는 놓일 자리가 달라서다 —
 * 버튼은 [다시 확인]과 같은 행 오른쪽 끝에 서고, 이쪽은 그 위 본문에 놓인다
 * (ClaudeLoginStatus/Action과 같은 구조).
 */
export function ClaudeInstallStatus(): React.JSX.Element | null {
  const { claudeInstallPhase, claudeInstallLog, claudeInstallError, claudeInstallLogPath } =
    useSetup()
  const logRef = useRef<HTMLPreElement>(null)

  // 새 출력이 오면 끝으로 따라간다 — 사용자가 매번 스크롤해야 하면 진행 상황을 볼 수 없다.
  useEffect(() => {
    const el = logRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [claudeInstallLog])

  // phase도 본다 — 로그 유무만 보면, 출력이 오기 전(curl -fsSL은 조용하다) 정작 "설치 중"을
  // 알려야 하는 구간에 아무 표시도 나오지 않는다.
  if (claudeInstallPhase !== 'running' && claudeInstallLog === '' && claudeInstallError === null) {
    return null
  }

  return (
    <>
      {claudeInstallLog !== '' && (
        <pre className="install-log" ref={logRef} aria-label="설치 진행 출력">
          {claudeInstallLog}
        </pre>
      )}
      {/* 실측 74초가 걸렸고 그동안 공식 installer가 출력을 한 줄도 내지 않았다 — 소요 시간을
          말해주지 않으면 사용자는 멈춘 줄 알고 [취소]를 누른다. */}
      {claudeInstallPhase === 'running' && (
        <p className="claude-waiting env-desc">
          <span className="rec-dot" aria-hidden="true" />
          설치 중… (1분 정도 걸릴 수 있습니다)
        </p>
      )}
      {claudeInstallError !== null && (
        <p className="env-error">
          설치 실패: {claudeInstallError}
          {/* 화면은 끝부분만 유지하므로 전문을 찾을 경로를 알려준다 — 이 레포에는 파일 로거가
              없어 이걸 빼면 패키징된 앱에서 원인을 볼 방법이 없다. */}
          {claudeInstallLogPath !== null && ` (전체 기록: ${claudeInstallLogPath})`}
        </p>
      )}
    </>
  )
}

/**
 * [다시 확인]과 같은 행에 놓는 주 동작. 설치 중에는 같은 자리가 [취소]로 바뀐다.
 *
 * 언마운트에서 설치를 취소하지 않는다. 이 버튼은 세션의 소유자가 아니다 — 패널 최소화(▼),
 * 설정 모달 닫기, 상태 변화로 인한 카드 소멸이 전부 언마운트를 일으키므로, 거기서 취소하면
 * 사용자가 시작한 설치가 파일을 쓰는 중에 죽는다. 게다가 phase가 idle로 초기화되면서
 * 중단됐다는 사실이 화면에서 사라진다. 세션 상태는 SetupProvider가 들고 있어서 화면을
 * 닫아도 결과가 도착해 상태가 갱신된다 — 취소는 사용자가 [취소]를 누를 때만 한다.
 */
export function ClaudeInstallAction(): React.JSX.Element {
  const { claudeInstallPhase, startClaudeInstall, cancelClaudeInstall } = useSetup()
  const running = claudeInstallPhase === 'running'

  if (running) {
    return (
      <button
        type="button"
        className="btn-ghost claude-action"
        onClick={() => void cancelClaudeInstall()}
      >
        취소
      </button>
    )
  }

  return (
    <>
      {/* 설치 문서는 실패했을 때만 내놓는다 — 성공 경로에서는 [설치하기]가 답이고,
          버튼을 늘리면 무엇을 눌러야 하는지가 흐려진다. */}
      {claudeInstallPhase === 'failed' && (
        <button
          type="button"
          className="btn-ghost"
          onClick={() => window.minuting.openExternal(CLAUDE_DOCS_URL).catch(() => {})}
        >
          설치 문서
        </button>
      )}
      <button
        type="button"
        className="btn-primary claude-action"
        onClick={() => void startClaudeInstall()}
      >
        {claudeInstallPhase === 'failed' ? '다시 설치' : '설치하기'}
      </button>
    </>
  )
}
