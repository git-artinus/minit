import type { TranscriptSegment } from './types'

// 병합 입력 — whisper 저장 경로는 endMs(정밀 침묵), 뷰어 경로는 startMs만(근사)을 넘긴다.
export interface MergeableSegment {
  startMs: number
  endMs?: number
  text: string
}

const PARAGRAPH_GAP_MS = 1000 // 이 이상 벌어지면 침묵으로 보고 새 문단
const SENTENCE_GAP_MS = 400 // 문장부호로 끝나며 이 이상 벌어지면 새 문단
const MAX_PARAGRAPH_CHARS = 280 // 문단 길이 상한(초과 시 강제 분리)
const SENTENCE_END_RE = /[.?!。？！]$/

// whisper 세그먼트를 읽기 쉬운 문단으로 병합한다. 순수 함수 — 저장(파이프라인)·뷰어(기존 회의록)
// 양쪽에서 공유한다. gap은 endMs가 있으면 이전 end→현재 start(정밀), 없으면 start→start(근사).
export function mergeParagraphs(segments: MergeableSegment[]): TranscriptSegment[] {
  const paragraphs: TranscriptSegment[] = []
  let cur: TranscriptSegment | null = null
  let prev: MergeableSegment | null = null

  for (const seg of segments) {
    const text = seg.text.trim()
    if (text === '') continue

    if (cur === null || prev === null) {
      cur = { startMs: seg.startMs, text }
      prev = seg
      continue
    }

    const prevEnd = prev.endMs ?? prev.startMs
    const gap = seg.startMs - prevEnd
    const pauseBreak = gap >= PARAGRAPH_GAP_MS
    const sentenceBreak = SENTENCE_END_RE.test(cur.text) && gap >= SENTENCE_GAP_MS
    const tooLong = cur.text.length + 1 + text.length > MAX_PARAGRAPH_CHARS

    if (pauseBreak || sentenceBreak || tooLong) {
      paragraphs.push(cur)
      cur = { startMs: seg.startMs, text }
    } else {
      cur = { startMs: cur.startMs, text: `${cur.text} ${text}` }
    }
    prev = seg
  }

  if (cur !== null) paragraphs.push(cur)
  return paragraphs
}
