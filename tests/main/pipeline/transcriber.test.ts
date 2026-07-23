import { describe, expect, test } from 'vitest'
import { parseWhisperSegments, transcribe } from '../../../src/main/pipeline/transcriber'

// whisper-cli -oj 출력 형식 (offsets는 밀리초)
const whisperOut = JSON.stringify({
  transcription: [
    { offsets: { from: 0, to: 4000 }, text: ' 오늘 스프린트 목표부터 정리하겠습니다.' },
    { offsets: { from: 4000, to: 9500 }, text: ' 지난주 이슈 공유드립니다.' },
    { offsets: { from: 9500, to: 9600 }, text: '  ' },  // 공백 세그먼트는 버린다
  ],
})

describe('parseWhisperSegments', () => {
  test('whisper offsets에서 startMs/endMs/text를 추출한다', () => {
    const raw = JSON.stringify({
      transcription: [
        { offsets: { from: 0, to: 3000 }, text: ' 안녕하세요 ' },
        { offsets: { from: 3200, to: 4000 }, text: '' },
      ],
    })
    expect(parseWhisperSegments(raw)).toEqual([{ startMs: 0, endMs: 3000, text: '안녕하세요' }])
  })
})

describe('transcribe', () => {
  test('whisper-cli를 올바른 인자로 실행하고 JSON 출력을 문단 병합해 반환한다', async () => {
    const calls: string[][] = []
    const segments = await transcribe({
      run: async (cmd, args) => { calls.push([cmd, ...args]); return { stdout: '' } },
      modelPath: '/ud/models/m.bin',
      wavPath: '/tmp/rec.wav',
      workDir: '/tmp',
      readFile: () => whisperOut,
    })
    expect(calls[0]).toEqual([
      'whisper-cli', '-m', '/ud/models/m.bin', '-f', '/tmp/rec.wav',
      '-l', 'ko', '-oj', '-of', '/tmp/rec',
    ])
    // 두 세그먼트 사이 gap 0ms < 문단 임계값 → 하나의 문단으로 병합된다.
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({
      startMs: 0,
      text: '오늘 스프린트 목표부터 정리하겠습니다. 지난주 이슈 공유드립니다.',
    })
  })
})
