import path from 'node:path'
import type { TranscriptSegment } from '../../shared/types'

export type RunCommand = (cmd: string, args: string[]) => Promise<{ stdout: string }>

interface WhisperJson {
  transcription: { offsets: { from: number; to: number }; text: string }[]
}

export function parseWhisperJson(raw: string): TranscriptSegment[] {
  const data = JSON.parse(raw) as WhisperJson
  return data.transcription
    .map((t) => ({ startMs: t.offsets.from, text: t.text.trim() }))
    .filter((s) => s.text.length > 0)
}

export async function transcribe(deps: {
  run: RunCommand
  // 번들 바이너리 절대경로 또는 PATH상의 명령명. 미지정 시 PATH의 whisper-cli를 그대로 실행한다.
  whisperPath?: string
  modelPath: string
  wavPath: string
  workDir: string
  readFile: (p: string) => string
}): Promise<TranscriptSegment[]> {
  const outBase = path.join(deps.workDir, path.basename(deps.wavPath, '.wav'))
  await deps.run(deps.whisperPath ?? 'whisper-cli', [
    '-m', deps.modelPath, '-f', deps.wavPath, '-l', 'ko', '-oj', '-of', outBase,
  ])
  return parseWhisperJson(deps.readFile(outBase + '.json'))
}
