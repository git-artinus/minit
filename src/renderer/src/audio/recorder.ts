export interface RecorderHandle {
  stop: () => Promise<Blob>
  elapsedMs: () => number
}

export async function startRecording(
  recordingId: string,
  flush: (id: string, chunk: ArrayBuffer) => Promise<void>
): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
  const chunks: Blob[] = []
  const startedAt = Date.now()
  let flushChain: Promise<void> = Promise.resolve()

  recorder.ondataavailable = (e): void => {
    if (e.data.size === 0) return
    chunks.push(e.data)
    flushChain = flushChain
      .then(() => e.data.arrayBuffer())
      .then((buf) => flush(recordingId, buf))
      .catch(() => {
        /* 플러시 실패는 무시 — 메모리 사본 유지 */
      })
  }
  recorder.start(5000) // 5초마다 플러시

  return {
    elapsedMs: () => Date.now() - startedAt,
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = (): void => {
          stream.getTracks().forEach((t) => t.stop())
          resolve(new Blob(chunks, { type: 'audio/webm' }))
        }
        recorder.stop()
      })
  }
}
