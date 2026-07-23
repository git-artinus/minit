import { describe, expect, test } from 'vitest'
import { encodeWavPcm16, resampleLinear } from '../../src/shared/wav'

describe('resampleLinear', () => {
  test('절반 레이트로 리샘플하면 길이가 절반이 된다', () => {
    const input = new Float32Array([0, 0.2, 0.4, 0.6, 0.8, 1.0, 0.8, 0.6])
    const out = resampleLinear(input, 32000, 16000)
    expect(out.length).toBe(4)
    expect(out[0]).toBeCloseTo(0)
  })
  test('같은 레이트면 그대로 반환한다', () => {
    const input = new Float32Array([0.1, 0.2])
    expect(resampleLinear(input, 16000, 16000)).toBe(input)
  })
})

describe('encodeWavPcm16', () => {
  test('RIFF/WAVE 헤더와 PCM16 데이터가 올바르다', () => {
    const buf = encodeWavPcm16(new Float32Array([0, 1, -1]), 16000)
    const view = new DataView(buf)
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF')
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(16000)         // sampleRate
    expect(view.getUint16(22, true)).toBe(1)             // mono
    expect(view.getInt16(44, true)).toBe(0)              // sample 0
    expect(view.getInt16(46, true)).toBe(32767)          // sample 1.0
    expect(view.getInt16(48, true)).toBe(-32768)         // sample -1.0
  })
})
