import fs from 'node:fs'
import path from 'node:path'

export const ARCHIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// 저장 성공한 녹음 원본(webm)을 recordings → archive로 이동한다. recordings에서 빠지므로
// listRecoverable(미완 복구 목록)에는 잡히지 않는다. 원본이 없으면 무시(중복 호출·이미 정리됨).
export function archiveRecording(recordingsDir: string, archiveDir: string, recordingId: string): void {
  const src = path.join(recordingsDir, `${recordingId}.webm`)
  if (!fs.existsSync(src)) return
  fs.mkdirSync(archiveDir, { recursive: true })
  fs.renameSync(src, path.join(archiveDir, `${recordingId}.webm`))
}

// 시작 시 호출 — mtime이 ttlMs를 넘긴 아카이브 파일을 삭제한다(best-effort).
export function sweepArchive(archiveDir: string, ttlMs: number, now: number): void {
  if (!fs.existsSync(archiveDir)) return
  for (const name of fs.readdirSync(archiveDir)) {
    const p = path.join(archiveDir, name)
    try {
      if (now - fs.statSync(p).mtimeMs > ttlMs) fs.rmSync(p, { force: true })
    } catch {
      // 개별 파일 정리 실패는 무시
    }
  }
}
