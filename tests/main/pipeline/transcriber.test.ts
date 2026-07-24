import { describe, expect, test, vi } from 'vitest'
import { transcribeRaw, retranscribeSpan, repairTranscript } from '../../../src/main/pipeline/transcriber'
import type { MergeableSegment } from '../../../src/shared/transcript'

const baseDeps = {
  whisperPath: '/bin/whisper-cli', modelPath: '/m.bin', wavPath: '/rec.wav', workDir: '/tmp',
}

function jsonOf(segs: { from: number; to: number; text: string }[]): string {
  return JSON.stringify({ transcription: segs.map((s) => ({ offsets: { from: s.from, to: s.to }, text: s.text })) })
}

describe('transcribeRaw', () => {
  test('최초 전사에 -mc 64를 적용하고 원본 세그먼트를 반환한다', async () => {
    const run = vi.fn(async () => ({ stdout: '' }))
    const readFile = vi.fn(() => jsonOf([{ from: 0, to: 2000, text: '발화' }]))
    const segs = await transcribeRaw({ ...baseDeps, run, readFile })
    const args = run.mock.calls[0][1] as string[]
    expect(args).toContain('-mc')
    expect(args[args.indexOf('-mc') + 1]).toBe('64')
    expect(segs).toEqual([{ startMs: 0, endMs: 2000, text: '발화' }])
  })
})

describe('retranscribeSpan', () => {
  test('-mc 0 + -ot + -d 로 구간만 재전사한다', async () => {
    const run = vi.fn(async () => ({ stdout: '' }))
    const readFile = vi.fn(() => jsonOf([{ from: 5000, to: 8000, text: '복구' }]))
    const segs = await retranscribeSpan({ ...baseDeps, run, readFile }, 5000, 20000)
    const args = run.mock.calls[0][1] as string[]
    expect(args[args.indexOf('-mc') + 1]).toBe('0')
    expect(args[args.indexOf('-ot') + 1]).toBe('5000')
    expect(args[args.indexOf('-d') + 1]).toBe('15000')
    expect(segs).toEqual([{ startMs: 5000, endMs: 8000, text: '복구' }])
  })
})

describe('repairTranscript', () => {
  const repeated: MergeableSegment[] = [
    { startMs: 0, endMs: 5000, text: '정상' },
    ...Array.from({ length: 8 }, (_, i) => ({ startMs: 5000 + i * 10000, endMs: 15000 + i * 10000, text: '반복문구.' })),
  ]

  test('반복이 없으면 원본 그대로, flagged=false', async () => {
    const retranscribe = vi.fn()
    const out = await repairTranscript([{ startMs: 0, endMs: 3000, text: '정상' }], retranscribe)
    expect(out).toEqual({ segments: [{ startMs: 0, endMs: 3000, text: '정상' }], flagged: false })
    expect(retranscribe).not.toHaveBeenCalled()
  })

  test('반복 구간을 재전사·스플라이스하고 복구되면 flagged=false', async () => {
    const retranscribe = vi.fn(async () => [{ startMs: 5000, endMs: 80000, text: '복구된 실제 발화' }])
    const out = await repairTranscript(repeated, retranscribe)
    expect(retranscribe).toHaveBeenCalledOnce()
    expect(out.flagged).toBe(false)
    expect(out.segments.map((s) => s.text)).toContain('복구된 실제 발화')
    expect(out.segments.some((s) => s.text === '반복문구.')).toBe(false)
  })

  test('재전사 후에도 반복이 남으면 flagged=true', async () => {
    const retranscribe = vi.fn(async () => repeated.slice(1)) // 여전히 반복
    const out = await repairTranscript(repeated, retranscribe)
    expect(out.flagged).toBe(true)
  })
})
