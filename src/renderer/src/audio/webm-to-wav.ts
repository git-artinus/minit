import { TARGET_RATE, encodeWavPcm16, resampleLinear } from '../../../shared/wav'

export async function webmToWav(blob: Blob): Promise<ArrayBuffer> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    // 멀티채널 → mono 평균
    const mono = new Float32Array(decoded.length)
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch)
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels
    }
    return encodeWavPcm16(resampleLinear(mono, decoded.sampleRate, TARGET_RATE), TARGET_RATE)
  } finally {
    await ctx.close()
  }
}
