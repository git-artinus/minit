import { useEffect, useState } from 'react'

export function RecordingBar(props: { startedAtMs: number; onStop: () => void }): React.JSX.Element {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const sec = Math.floor((Date.now() - props.startedAtMs) / 1000)
  const mm = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return (
    <div className="recording-bar">
      <span className="rec-dot" aria-hidden="true" />
      <span className="recording-label">녹음 중</span>
      <span className="recording-elapsed">{mm}:{ss}</span>
      <button type="button" className="btn-primary recording-stop" onClick={props.onStop}>
        회의 종료
      </button>
    </div>
  )
}
