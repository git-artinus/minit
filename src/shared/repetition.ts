import type { MergeableSegment } from './transcript'

export interface RepetitionSpan {
  startMs: number
  endMs: number
  repeatedText: string
  count: number
}

// 캘리브레이션 대상(코퍼스로 조정) — 짧은 실제 맞장구는 제외하고 지속된 hallucination loop만 잡는다.
const MIN_REPEAT_COUNT = 6
const MIN_SPAN_MS = 60_000

// 공백·구두점을 제거해 "구두점만 다른" 반복을 동일 텍스트로 본다.
function normalize(text: string): string {
  return text.replace(/[\s.,!?。？！·…]/g, '')
}

function endOf(seg: MergeableSegment): number {
  return seg.endMs ?? seg.startMs
}

export function detectRepetitions(segments: MergeableSegment[]): RepetitionSpan[] {
  const spans: RepetitionSpan[] = []
  let i = 0
  while (i < segments.length) {
    const key = normalize(segments[i].text)
    let j = i + 1
    if (key !== '') {
      while (j < segments.length && normalize(segments[j].text) === key) j++
    }
    const count = j - i
    if (count >= MIN_REPEAT_COUNT) {
      const startMs = segments[i].startMs
      const endMs = endOf(segments[j - 1])
      if (endMs - startMs >= MIN_SPAN_MS) {
        spans.push({ startMs, endMs, repeatedText: segments[i].text, count })
      }
    }
    i = j > i ? j : i + 1
  }
  return spans
}

export function spliceSegments(
  segments: MergeableSegment[],
  span: { startMs: number; endMs: number },
  replacement: MergeableSegment[],
): MergeableSegment[] {
  // span.endMs는 반복 구간 마지막 세그먼트의 endMs이므로, startMs가 정확히 span.endMs와
  // 같은 다음 실제 세그먼트는 반복 구간이 아니라 그 바로 뒤에 이어지는 세그먼트다.
  // 경계를 포함(>=)해 제거해야 반복 세그먼트는 모두 걸러지고(자기 endMs보다 항상 이르므로),
  // 뒤이어 붙은 세그먼트는 유실 없이 남는다.
  const kept = segments.filter((s) => s.startMs < span.startMs || s.startMs >= span.endMs)
  return [...kept, ...replacement].sort((a, b) => a.startMs - b.startMs)
}
