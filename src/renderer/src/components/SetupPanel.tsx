import { BrandMark } from './BrandLogo'
import { useSetup } from '../state/setup'
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
    case 'claude-missing':
      return '요약 기능을 쓰려면 Claude CLI가 필요합니다'
    default:
      return '음성 인식 준비'
  }
}

export function SetupPanel(): React.JSX.Element | null {
  const { view, minimized, setMinimized, recheck, download, envError } = useSetup()
  if (view.kind === 'hidden') return null

  return (
    <div className="setup-panel">
      <div className="setup-panel-header">
        <BrandMark size={16} />
        <span className="setup-panel-title">{panelTitle(view.kind)}</span>
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

          {/* 비차단 안내 — claude가 없어도 녹음·받아쓰기는 되므로 회의 시작을 막지 않는다. */}
          {view.kind === 'claude-missing' && (
            <>
              <p className="env-desc">{CLAUDE_DEPENDENCY_NOTICE}</p>
              <p className="env-desc">터미널에서 아래를 실행해 설치한 뒤 [다시 확인]을 누르세요.</p>
              <div className="setting-path">{CLAUDE_INSTALL_COMMAND}</div>
              <div className="setting-path-row">
                <button type="button" className="btn-primary" onClick={recheck}>
                  다시 확인
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => window.minuting.openExternal(CLAUDE_DOCS_URL).catch(() => {})}
                >
                  설치 문서 열기
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
