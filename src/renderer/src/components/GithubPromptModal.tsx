import { useState } from 'react'
import { GithubConnectFlow } from './GithubConnectFlow'

// 최초 1회 GitHub 연결 안내 팝업(v0.3.0 ③). Slack 안내보다 먼저 뜬다(App.tsx 순서 제어).
// Device Flow 진행 중에는 배경 클릭으로 닫히지 않게 한다(진행 상태 유실 방지).
export function GithubPromptModal(props: { onDone: () => void }): React.JSX.Element {
  const [connecting, setConnecting] = useState(false)

  return (
    <div className="modal-backdrop" onClick={connecting ? undefined : props.onDone}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>GitHub 연결</h2>
        </header>
        {connecting ? (
          <>
            <GithubConnectFlow
              onDone={(result) => {
                // 성공(또는 나중에 선택)이면 온보딩을 완전히 닫는다. 취소(null)면 연결/스킵을
                // 다시 고를 수 있게 이전 화면으로 되돌아간다(리뷰 Fix 3 — 진행 중에도 재시도 가능).
                if (result) props.onDone()
                else setConnecting(false)
              }}
            />
            <button type="button" className="btn-ghost" onClick={props.onDone}>
              로그인 없이 사용하기
            </button>
          </>
        ) : (
          <>
            <p className="env-desc">
              GitHub에 연결하면 회의록이 선택한 저장소에 자동 백업됩니다.
            </p>
            <button type="button" className="btn-primary" onClick={() => setConnecting(true)}>
              GitHub 연결
            </button>
            <button type="button" className="btn-ghost" onClick={props.onDone}>
              로그인 없이 사용하기
            </button>
          </>
        )}
      </div>
    </div>
  )
}
