import { encodeWavPcm16 } from '../../../shared/wav'

// whisper.cpp 요구 레이트로 바로 디코드한다 — decodeAudioData가 컨텍스트 레이트로 리샘플하며
// 저역통과는 브라우저(Chromium sinc) 구현이 처리한다. 기존의 직접 선형 보간은 저역통과가 없어
// 에일리어싱이 접혀 들어가는 잘못된 다운샘플이었다(회의 4건 실측 근거는 #57).
// 16kHz 고정인 이유: PATH 폴백 whisper-cli(구버전 brew·자가 빌드)는 16kHz WAV만 받는다.
const DECODE_RATE = 16_000

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
