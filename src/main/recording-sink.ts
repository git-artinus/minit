import fs from 'node:fs'
import path from 'node:path'

const RECORDING_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

export function isValidRecordingId(id: string): boolean {
  return RECORDING_ID_PATTERN.test(id)
}

export function recordingPath(recordingsDir: string, recordingId: string): string {
  return path.join(recordingsDir, `${recordingId}.webm`)
}

export function appendChunk(recordingsDir: string, recordingId: string, chunk: Buffer): void {
  fs.mkdirSync(recordingsDir, { recursive: true })
  fs.appendFileSync(recordingPath(recordingsDir, recordingId), chunk)
}

export function listRecoverable(recordingsDir: string): string[] {
  if (!fs.existsSync(recordingsDir)) return []
  return fs.readdirSync(recordingsDir)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => f.replace(/\.webm$/, ''))
}

export function readRecording(recordingsDir: string, recordingId: string): Buffer {
  return fs.readFileSync(recordingPath(recordingsDir, recordingId))
}

export function removeRecording(recordingsDir: string, recordingId: string): void {
  fs.rmSync(recordingPath(recordingsDir, recordingId), { force: true })
}
