import { afterEach, describe, expect, test } from 'vitest'
import { webmToWav } from '../../src/renderer/src/audio/webm-to-wav'

// OfflineAudioContext는 렌더러(Chromium) 전용이라 노드 환경에서는 스텁으로 대체한다.
// 검증 대상은 우리가 넘기는 값(컨텍스트 샘플레이트)과 디코드 결과를 다루는 방식이다.
interface FakeBuffer {
  numberOfChannels: number
  length: number
  sampleRate: number
  getChannelData: (i: number) => Float32Array
}

function fakeBuffer(
  channels: Float32Array[],
  sampleRate: number
): FakeBuffer & { calls: number[] } {
  const calls: number[] = []
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    getChannelData: (i: number): Float32Array => {
      calls.push(i)
      return channels[i]
    },
    calls
  }
}

const contexts: { channels: number; length: number; rate: number }[] = []

function stubOfflineAudioContext(buffer: FakeBuffer): void {
  class Stub {
    constructor(channels: number, length: number, rate: number) {
      contexts.push({ channels, length, rate })
    }
    async decodeAudioData(): Promise<FakeBuffer> {
      return buffer
    }
  }
  ;(globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = Stub
}

const emptyBlob = (): Blob => new Blob([new Uint8Array([1, 2, 3])])
const samplesOf = (wav: ArrayBuffer): number[] => {
  const view = new DataView(wav)
  const count = view.getUint32(40, true) / 2
  return Array.from({ length: count }, (_, i) => view.getInt16(44 + i * 2, true))
}

afterEach(() => {
  contexts.length = 0
  delete (globalThis as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext
})

describe('webmToWav', () => {
  test('24kHz 컨텍스트로 디코드하고 그 레이트를 WAV 헤더에 쓴다', async () => {
    stubOfflineAudioContext(fakeBuffer([new Float32Array([0, 0.5])], 24_000))
    const wav = await webmToWav(emptyBlob())
    expect(contexts[0].rate).toBe(24_000) // 앱은 직접 리샘플하지 않는다 — whisper가 16kHz로 변환한다
    expect(new DataView(wav).getUint32(24, true)).toBe(24_000)
  })

  test('mono 입력은 채널 데이터를 복사 없이 그대로 인코딩한다', async () => {
    const buffer = fakeBuffer([new Float32Array([0, 1, -1])], 24_000)
    stubOfflineAudioContext(buffer)
    const wav = await webmToWav(emptyBlob())
    expect(buffer.calls).toEqual([0]) // 채널 0을 한 번만 읽고 별도 버퍼를 만들지 않는다
    expect(samplesOf(wav)).toEqual([0, 32767, -32768])
  })

  test('멀티채널 입력은 채널 평균으로 다운믹스한다', async () => {
    stubOfflineAudioContext(
      fakeBuffer([new Float32Array([1, 0, 0.5]), new Float32Array([0, 1, 0.5])], 24_000)
    )
    const wav = await webmToWav(emptyBlob())
    // (1+0)/2, (0+1)/2, (0.5+0.5)/2 → 0.5, 0.5, 0.5
    expect(samplesOf(wav)).toEqual([16383, 16383, 16383])
  })
})
