import { encodeWavPcm16 } from '../../../shared/wav'

// 앱은 리샘플을 직접 하지 않는다 — 16kHz 변환은 whisper-cli(miniaudio)가 처리한다.
// 기존에는 저역통과 없는 선형 보간으로 48kHz를 16kHz로 내렸는데, 에일리어싱이 그대로 접혀
// 들어가는 잘못된 다운샘플이고 피크 메모리도 더 썼다(회의 4건 실측 근거는 #57).
// 24kHz는 음성 대역(8kHz 이하)을 온전히 담으면서 WAV 크기를 48kHz의 절반으로 유지한다.
const DECODE_RATE = 24_000

export async function webmToWav(blob: Blob): Promise<ArrayBuffer> {
  const ctx = new OfflineAudioContext(1, 1, DECODE_RATE)
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
  return encodeWavPcm16(downmixMono(decoded), decoded.sampleRate)
}

function downmixMono(decoded: AudioBuffer): Float32Array {
  // 마이크 입력은 보통 mono다 — 채널이 하나면 복사하지 않고 그대로 쓴다.
  // 48kHz float 버퍼는 1시간 회의에서 700MB 규모라 이 복사 한 번이 피크 메모리를 그만큼 올린다.
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0)
  const mono = new Float32Array(decoded.length)
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const data = decoded.getChannelData(ch)
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels
  }
  return mono
}
