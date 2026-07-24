import { describe, expect, test } from 'vitest'
import { detectRepetitions, spliceSegments } from '../../src/shared/repetition'
import type { MergeableSegment } from '../../src/shared/transcript'

// 헬퍼: startMs부터 stepMs 간격으로 같은 텍스트를 n개 만든다(각 세그먼트 길이 stepMs).
function run(text: string, startMs: number, n: number, stepMs = 10_000): MergeableSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    startMs: startMs + i * stepMs,
    endMs: startMs + (i + 1) * stepMs,
    text,
  }))
}

describe('detectRepetitions', () => {
  test('연속 6회 이상·60초 이상 반복은 span으로 잡는다', () => {
    const segs = [{ startMs: 0, endMs: 5_000, text: '정상 발화' }, ...run('반복문구.', 5_000, 8)]
    const spans = detectRepetitions(segs)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toEqual({ startMs: 5_000, endMs: 85_000, repeatedText: '반복문구.', count: 8 })
  })

  test('반복 횟수가 임계 미만이면 잡지 않는다', () => {
    expect(detectRepetitions(run('짧은반복.', 0, 3))).toEqual([])
  })

  test('지속 시간이 임계 미만이면 잡지 않는다', () => {
    // 8회지만 각 2초 → 16초 < 60초
    expect(detectRepetitions(run('빠른반복.', 0, 8, 2_000))).toEqual([])
  })

  test('구두점·공백만 다른 반복은 같은 것으로 본다', () => {
    const segs = [
      ...Array.from({ length: 7 }, (_, i) => ({
        startMs: i * 10_000, endMs: (i + 1) * 10_000, text: i % 2 ? '반복 문구' : '반복문구.',
      })),
    ]
    expect(detectRepetitions(segs)).toHaveLength(1)
  })

  test('반복 없는 정상 트랜스크립트는 빈 배열', () => {
    const segs = [
      { startMs: 0, endMs: 3_000, text: '첫 발언' },
      { startMs: 3_000, endMs: 6_000, text: '둘째 발언' },
      { startMs: 6_000, endMs: 9_000, text: '셋째 발언' },
    ]
    expect(detectRepetitions(segs)).toEqual([])
  })

  test('endMs가 없으면 startMs를 종료로 근사한다', () => {
    const segs = Array.from({ length: 8 }, (_, i) => ({ startMs: i * 10_000, text: '반복문구.' }))
    const spans = detectRepetitions(segs)
    expect(spans).toHaveLength(1)
    expect(spans[0].endMs).toBe(70_000) // 마지막 세그먼트 startMs
  })
})

describe('spliceSegments', () => {
  test('span 범위 세그먼트를 replacement로 교체하고 시간순 정렬', () => {
    const segs = [
      { startMs: 0, endMs: 5_000, text: '앞' },
      ...run('반복문구.', 5_000, 3),
      { startMs: 40_000, endMs: 45_000, text: '뒤' },
    ]
    const span = { startMs: 5_000, endMs: 35_000 }
    const replacement = [{ startMs: 5_000, endMs: 20_000, text: '복구된 실제 발화' }]
    const out = spliceSegments(segs, span, replacement)
    expect(out.map((s) => s.text)).toEqual(['앞', '복구된 실제 발화', '뒤'])
  })
})
