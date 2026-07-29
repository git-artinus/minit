import { BrandMark } from './BrandLogo'
import { useSetup } from '../state/setup'
import { claudeStatusView } from '../state/claude-status-view'
import { CLAUDE_DEPENDENCY_NOTICE, CLAUDE_DOCS_URL, CLAUDE_INSTALL_COMMAND } from '../../../shared/claude-cli'

const WHISPER_HINT =
  '음성 인식(받아쓰기)에 사용 — Apple Silicon Mac은 앱에 포함되어 있어 보통 이 안내가 나오지 않습니다. 계속 보인다면 Intel Mac이거나 파일 손상: 터미널에서 brew install whisper-cpp 실행'

function panelTitle(kind: string): string {
  switch (kind) {
    case 'unsupported':
      return '실행에 필요한 프로그램이 없습니다'
    case 'downloading':
      return '음성 인식 준비 중'
    case 'error':
      return '음성 인식 준비 실패'
    case 'checking':
      return '환경 확인 중'
    default:
      return '음성 인식 준비'
  }
}

export function SetupPanel(): React.JSX.Element | null {
  const { view, minimized, setMinimized, recheck, download, envError, recheckClaude, claudeChecking, claudeError } =
    useSetup()
  if (view.kind === 'hidden') return null
  // 제목과 본문이 같은 판정을 써야 한다 — 따로 계산하면 미설치 제목 아래 로그인 안내가 뜰 수 있다.
  // 미설치·미로그인·사용량 소진은 해야 할 일이 서로 달라 제목부터 갈라진다.
  const claudeCard =
    view.kind === 'claude-unavailable'
      ? claudeStatusView({ kind: 'unavailable', failure: view.failure })
      : null

  return (
    <div className="setup-panel">
      <div className="setup-panel-header">
        <BrandMark size={16} />
        <span className="setup-panel-title">{claudeCard?.title ?? panelTitle(view.kind)}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setMinimized(!minimized)}
          aria-label={minimized ? '설치 패널 펼치기' : '설치 패널 최소화'}
        >
          {minimized ? '▲' : '▼'}
        </button>
      </div>
      {!minimized && (
        <div className="setup-panel-body">
          {view.kind === 'checking' &&
            (envError === null ? (
              <p className="env-desc">환경 확인 중…</p>
            ) : (
              // 검사가 실패하면 env가 null로 남아 영구히 '확인 중'이 된다 — 사실을 알리고 재시도를 준다.
              <>
                <p className="env-error">환경 확인 실패: {envError}</p>
                <button type="button" className="btn-primary" onClick={recheck}>
                  다시 확인
                </button>
              </>
            ))}

          {view.kind === 'unsupported' && (
            <>
              <ul>
                <li>
                  <b>whisper-cli</b> — {WHISPER_HINT}
                </li>
              </ul>
              <button type="button" className="btn-primary" onClick={recheck}>
                다시 확인
              </button>
            </>
          )}

          {view.kind === 'needs-model' && (
            <>
              <p className="env-desc">
                회의 음성을 텍스트로 바꿔 주는 음성 인식 AI 모델이 필요합니다.
                <br />
                최초 1회만 다운로드하며, 이후에는 바로 사용할 수 있습니다.
              </p>
              <button type="button" className="btn-primary" onClick={download}>
                다운로드 시작 (약 1.6GB · 최초 1회)
              </button>
            </>
          )}

          {view.kind === 'downloading' && (
            <>
              <div
                className="progress-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  view.progress.total > 0
                    ? Math.round((view.progress.received / view.progress.total) * 100)
                    : 0
                }
              >
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${
                      view.progress.total > 0
                        ? Math.min(100, (view.progress.received / view.progress.total) * 100)
                        : 0
                    }%`
                  }}
                />
              </div>
              <p className="env-progress-label">
                다운로드 중… {(view.progress.received / 1e6).toFixed(0)}MB /{' '}
                {(view.progress.total / 1e6).toFixed(0)}MB
              </p>
              <p className="env-desc">완료되면 자동으로 사라집니다.</p>
            </>
          )}

          {view.kind === 'error' && (
            <>
              <p className="env-error">다운로드 실패: {view.message}</p>
              <button type="button" className="btn-primary" onClick={download}>
                다시 시도
              </button>
            </>
          )}

          {/* 비차단 안내 — claude를 못 써도 녹음·받아쓰기는 되므로 회의 시작을 막지 않는다. */}
          {view.kind === 'claude-unavailable' && claudeCard && (
            <>
              <p className="env-desc">{CLAUDE_DEPENDENCY_NOTICE}</p>
              {claudeCard.hint !== null && <p className="env-desc">{claudeCard.hint}</p>}
              {claudeCard.showInstall && <div className="setting-path">{CLAUDE_INSTALL_COMMAND}</div>}
              {claudeCard.detail !== null && <p className="env-error">{claudeCard.detail}</p>}
              {/* 재확인이 실패한 경우. 위 안내는 직전 확인 결과이므로 그대로 두고 사실만 덧붙인다. */}
              {claudeError !== null && (
                <p className="env-error">상태 확인 실패: {claudeError} (위는 직전 확인 결과입니다)</p>
              )}
              <div className="setting-path-row">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    recheckClaude().catch(() => {})
                  }}
                  disabled={claudeChecking}
                >
                  {claudeChecking ? '확인 중…' : '다시 확인'}
                </button>
                {claudeCard.showInstall && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => window.minuting.openExternal(CLAUDE_DOCS_URL).catch(() => {})}
                  >
                    설치 문서 열기
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
