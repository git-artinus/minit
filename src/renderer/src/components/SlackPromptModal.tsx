// 최초 1회 Slack 연동 안내 팝업(v0.3.0 ②). 기존 모달 스타일(.modal-backdrop/.modal)을 재사용한다.
export function SlackPromptModal(props: {
  onConnect: () => void
  onLater: () => void
}): React.JSX.Element {
  return (
    <div className="modal-backdrop" onClick={props.onLater}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Slack 연동</h2>
        </header>
        <p className="env-desc">Slack 봇 토큰을 연결해 회의 요약을 원하는 채널로 자동 발송할까요?</p>
        <button type="button" className="btn-primary" onClick={props.onConnect}>
          설정에서 연결
        </button>
        <button type="button" className="btn-ghost" onClick={props.onLater}>
          나중에
        </button>
      </div>
    </div>
  )
}
