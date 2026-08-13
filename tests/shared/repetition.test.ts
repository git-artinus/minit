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
  test('연속 6회 이상·20초 이상 반복은 span으로 잡는다', () => {
    const segs = [{ startMs: 0, endMs: 5_000, text: '정상 발화' }, ...run('반복문구.', 5_000, 8)]
    const spans = detectRepetitions(segs)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toEqual({ startMs: 5_000, endMs: 85_000, repeatedText: '반복문구.', count: 8 })
  })

  test('반복 횟수가 임계 미만이면 잡지 않는다', () => {
    expect(detectRepetitions(run('짧은반복.', 0, 3))).toEqual([])
  })

  test('지속 시간이 임계 미만이면 잡지 않는다', () => {
    // 8회지만 각 2초 → 16초 < 20초
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

  test('count가 정확히 MIN_REPEAT_COUNT(6)이면 탐지, 5면 탐지하지 않는다(duration은 양쪽 다 충분)', () => {
    // stepMs=15_000 → count=6일 때 duration 90_000, count=5일 때 duration 75_000. 둘 다 20_000 이상이라
    // duration 문턱과 무관하게 count 문턱만으로 갈린다.
    const detected = detectRepetitions(run('경계반복.', 0, 6, 15_000))
    expect(detected).toHaveLength(1)
    expect(detected[0].count).toBe(6)

    const notDetected = detectRepetitions(run('경계반복.', 0, 5, 15_000))
    expect(notDetected).toEqual([])
  })

  test('duration이 MIN_SPAN_MS(20_000)이면 탐지하고 미만이면 탐지하지 않는다(경계 포함, >=)', () => {
    const spans = detectRepetitions(run('경계지속시간.', 0, 10, 2_000))
    expect(spans).toHaveLength(1)
    expect(spans[0].endMs - spans[0].startMs).toBe(20_000)

    // 6회·3_333ms → duration 19_998. count 문턱은 충족하므로 duration 문턱만으로 갈린다.
    // 위 단언과 짝지어 문턱을 양방향으로 고정한다(값을 낮추면 이쪽이 깨진다).
    expect(detectRepetitions(run('경계지속시간.', 0, 6, 3_333))).toEqual([])
  })

  // whisper 원본 세그먼트 321~329(1,416,840~1,460,840ms) 실측 케이스.
  // 44초/9회라 기존 60초 문턱에 미달해 걸러지지 않았고, 트랜스크립트에 그대로 남았다(Refs #54).
  test('실측 hallucination loop(44초·9회)를 탐지한다', () => {
    const bounds = [
      [1_416_840, 1_418_840],
      [1_418_840, 1_420_840],
      [1_420_840, 1_424_840],
      [1_424_840, 1_426_840],
      [1_426_840, 1_428_840],
      [1_428_840, 1_446_840],
      [1_446_840, 1_450_840],
      [1_450_840, 1_458_840],
      [1_458_840, 1_460_840]
    ]
    const segs = [
      { startMs: 1_414_840, endMs: 1_416_840, text: '앞 발화' },
      ...bounds.map(([startMs, endMs]) => ({ startMs, endMs, text: '롱고시피' })),
      { startMs: 1_460_840, endMs: 1_468_840, text: '뒤 발화' }
    ]
    const spans = detectRepetitions(segs)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toEqual({
      startMs: 1_416_840,
      endMs: 1_460_840,
      repeatedText: '롱고시피',
      count: 9
    })
  })

  test('공백·구두점만 있는 텍스트가 길게 반복돼도 잡지 않는다(침묵을 반복으로 오탐하지 않음)', () => {
    expect(detectRepetitions(run('   ', 0, 8))).toEqual([])
    expect(detectRepetitions(run('...', 0, 8))).toEqual([])
    expect(detectRepetitions(run('', 0, 8))).toEqual([])
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

  test('다음 세그먼트의 startMs가 span.endMs와 정확히 같아도 유실되지 않는다(경계 회귀 테스트)', () => {
    const segs = [
      { startMs: 0, endMs: 5_000, text: '앞' },
      ...run('반복문구.', 5_000, 3), // 5_000~35_000, 마지막 세그먼트 endMs === 35_000
      { startMs: 35_000, endMs: 40_000, text: '이어지는 실제 발화' }, // startMs === span.endMs
    ]
    const span = { startMs: 5_000, endMs: 35_000 }
    const replacement = [{ startMs: 5_000, endMs: 20_000, text: '복구된 실제 발화' }]
    const out = spliceSegments(segs, span, replacement)
    expect(out.map((s) => s.text)).toEqual(['앞', '복구된 실제 발화', '이어지는 실제 발화'])
  })
})
