import path from 'node:path'
import type { TranscriptSegment } from '../../shared/types'
import { mergeParagraphs, type MergeableSegment } from '../../shared/transcript'
import { detectRepetitions, spliceSegments } from '../../shared/repetition'

export type RunCommand = (cmd: string, args: string[]) => Promise<{ stdout: string }>

interface WhisperJson {
  transcription: { offsets: { from: number; to: number }; text: string }[]
}

export function parseWhisperSegments(raw: string): MergeableSegment[] {
  const data = JSON.parse(raw) as WhisperJson
  return data.transcription
    .map((t) => ({ startMs: t.offsets.from, endMs: t.offsets.to, text: t.text.trim() }))
    .filter((s) => s.text.length > 0)
}

export interface TranscribeDeps {
  run: RunCommand
  whisperPath?: string
  modelPath: string
  wavPath: string
  workDir: string
  readFile: (p: string) => string
}

// 최초 전사 — 문맥 상한 -mc 64(P2)로 previous-text 조건화 루프 위험을 낮춘다(whisper.cpp#2286 권장).
// 병합은 하지 않고 원본 세그먼트를 반환한다(반복 탐지는 병합 전 세그먼트에서 정확).
export async function transcribeRaw(deps: TranscribeDeps): Promise<MergeableSegment[]> {
  const outBase = path.join(deps.workDir, path.basename(deps.wavPath, '.wav'))
  await deps.run(deps.whisperPath ?? 'whisper-cli', [
    '-m', deps.modelPath, '-f', deps.wavPath, '-l', 'ko', '-mc', '64', '-oj', '-of', outBase,
  ])
  return parseWhisperSegments(deps.readFile(outBase + '.json'))
}

// 반복 구간만 재전사 — -mc 0으로 이전 텍스트 조건화를 끊고 -ot/-d로 시간범위를 한정한다.
// 반환 offset은 절대값이라 스플라이스가 그대로 성립한다.
export async function retranscribeSpan(
  deps: TranscribeDeps, startMs: number, endMs: number,
): Promise<MergeableSegment[]> {
  const outBase = path.join(deps.workDir, `${path.basename(deps.wavPath, '.wav')}-repair-${startMs}`)
  await deps.run(deps.whisperPath ?? 'whisper-cli', [
    '-m', deps.modelPath, '-f', deps.wavPath, '-l', 'ko', '-mc', '0',
    '-ot', String(startMs), '-d', String(endMs - startMs), '-oj', '-of', outBase,
  ])
  return parseWhisperSegments(deps.readFile(outBase + '.json'))
}

// 탐지 → 각 반복 구간 1회 재전사 → 스플라이스 → 재탐지. 재전사 후에도 남는 반복은 flagged로만
// 표시하고 원본을 유지한다(무한 재시도 방지 — 초기 span만 재전사한다).
export async function repairTranscript(
  raw: MergeableSegment[],
  retranscribe: (startMs: number, endMs: number) => Promise<MergeableSegment[]>,
): Promise<{ segments: MergeableSegment[]; flagged: boolean }> {
  const spans = detectRepetitions(raw)
  if (spans.length === 0) return { segments: raw, flagged: false }
  let result = raw
  for (const span of spans) {
    const replacement = await retranscribe(span.startMs, span.endMs)
    result = spliceSegments(result, span, replacement)
  }
  return { segments: result, flagged: detectRepetitions(result).length > 0 }
}

// ipc가 주입해 쓰는 조합 진입점 — 최초 전사(+예방) → 복구 → 문단 병합. flagged를 함께 반환한다.
export async function transcribeAndRepair(
  deps: TranscribeDeps,
): Promise<{ segments: TranscriptSegment[]; flagged: boolean }> {
  const raw = await transcribeRaw(deps)
  const { segments, flagged } = await repairTranscript(raw, (s, e) => retranscribeSpan(deps, s, e))
  return { segments: mergeParagraphs(segments), flagged }
}
