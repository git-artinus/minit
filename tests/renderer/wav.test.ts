import { describe, expect, test } from 'vitest'
import { encodeWavPcm16 } from '../../src/shared/wav'

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
