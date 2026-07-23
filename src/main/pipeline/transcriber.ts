import path from 'node:path'
import type { TranscriptSegment } from '../../shared/types'
import { mergeParagraphs, type MergeableSegment } from '../../shared/transcript'

export type RunCommand = (cmd: string, args: string[]) => Promise<{ stdout: string }>

interface WhisperJson {
  transcription: { offsets: { from: number; to: number }; text: string }[]
}

// whisper JSON에서 endMs까지 보존해 파싱한다(문단 병합의 정밀 gap 계산용).
export function parseWhisperSegments(raw: string): MergeableSegment[] {
  const data = JSON.parse(raw) as WhisperJson
  return data.transcription
    .map((t) => ({ startMs: t.offsets.from, endMs: t.offsets.to, text: t.text.trim() }))
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
  // 저장 경로: endMs가 살아있는 시점에 문단 병합(정밀). 이후 TranscriptSegment(startMs만)로 저장된다.
  return mergeParagraphs(parseWhisperSegments(deps.readFile(outBase + '.json')))
}
