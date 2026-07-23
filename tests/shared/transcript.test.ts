import { describe, expect, test } from 'vitest'
import { mergeParagraphs } from '../../src/shared/transcript'

describe('mergeParagraphs', () => {
  test('침묵(end→start gap ≥ 1s)에서 문단을 나눈다', () => {
    const out = mergeParagraphs([
      { startMs: 0, endMs: 3000, text: '안녕하세요' },
      { startMs: 3200, endMs: 4000, text: '반갑습니다' }, // gap 200ms → 이어붙임
      { startMs: 6000, endMs: 7000, text: '다음 안건입니다' }, // gap 2000ms → 새 문단
    ])
    expect(out).toEqual([
      { startMs: 0, text: '안녕하세요 반갑습니다' },
      { startMs: 6000, text: '다음 안건입니다' },
    ])
  })

  test('문장부호로 끝나고 gap ≥ 0.4s면 문단을 나눈다', () => {
    const out = mergeParagraphs([
      { startMs: 0, endMs: 1000, text: '결정했습니다.' },
      { startMs: 1500, endMs: 2000, text: '다음으로' }, // gap 500ms + 앞이 마침표 → 새 문단
    ])
    expect(out.map((p) => p.text)).toEqual(['결정했습니다.', '다음으로'])
  })

  test('end가 없으면 start→start gap으로 근사한다(뷰어 경로)', () => {
    const out = mergeParagraphs([
      { startMs: 0, text: '한 문장' },
      { startMs: 300, text: '이어짐' }, // start gap 300ms → 이어붙임
      { startMs: 2000, text: '멀리 떨어진 문장' }, // start gap 1700ms → 새 문단
    ])
    expect(out.map((p) => p.text)).toEqual(['한 문장 이어짐', '멀리 떨어진 문장'])
  })

  test('길이 상한(280자) 초과 시 강제 분리', () => {
    const long = 'ㄱ'.repeat(200)
    const out = mergeParagraphs([
      { startMs: 0, endMs: 100, text: long },
      { startMs: 150, endMs: 200, text: long }, // gap 50ms지만 합치면 400자 > 280 → 분리
    ])
    expect(out.length).toBe(2)
  })

  test('빈 세그먼트는 무시, 전체 빈 입력은 빈 배열', () => {
    expect(mergeParagraphs([])).toEqual([])
    expect(mergeParagraphs([{ startMs: 0, text: '  ' }])).toEqual([])
  })

  test('pause 경계: gap 정확히 1000ms면 분리, 999ms면 병합', () => {
    expect(
      mergeParagraphs([
        { startMs: 0, endMs: 0, text: 'A' },
        { startMs: 1000, endMs: 1000, text: 'B' },
      ]).map((p) => p.text)
    ).toEqual(['A', 'B'])
    expect(
      mergeParagraphs([
        { startMs: 0, endMs: 0, text: 'A' },
        { startMs: 999, endMs: 999, text: 'B' },
      ]).map((p) => p.text)
    ).toEqual(['A B'])
  })

  test('sentence 경계: 문장부호+gap 정확히 400ms면 분리, 399ms면 병합', () => {
    expect(
      mergeParagraphs([
        { startMs: 0, endMs: 0, text: '끝.' },
        { startMs: 400, endMs: 400, text: '다음' },
      ]).map((p) => p.text)
    ).toEqual(['끝.', '다음'])
    expect(
      mergeParagraphs([
        { startMs: 0, endMs: 0, text: '끝.' },
        { startMs: 399, endMs: 399, text: '다음' },
      ]).map((p) => p.text)
    ).toEqual(['끝. 다음'])
  })

  test('단일 비어있지 않은 세그먼트는 그대로 통과', () => {
    expect(mergeParagraphs([{ startMs: 0, text: 'hi' }])).toEqual([{ startMs: 0, text: 'hi' }])
  })
})
