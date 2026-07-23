import { describe, expect, test } from 'vitest'
import { parseWhisperJson, transcribe } from '../../../src/main/pipeline/transcriber'

// whisper-cli -oj 출력 형식 (offsets는 밀리초)
const whisperOut = JSON.stringify({
  transcription: [
    { offsets: { from: 0, to: 4000 }, text: ' 오늘 스프린트 목표부터 정리하겠습니다.' },
    { offsets: { from: 4000, to: 9500 }, text: ' 지난주 이슈 공유드립니다.' },
    { offsets: { from: 9500, to: 9600 }, text: '  ' },  // 공백 세그먼트는 버린다
  ],
})

describe('parseWhisperJson', () => {
  test('세그먼트 텍스트를 trim하고 offsets.from을 startMs로 쓴다', () => {
    expect(parseWhisperJson(whisperOut)).toEqual([
      { startMs: 0, text: '오늘 스프린트 목표부터 정리하겠습니다.' },
      { startMs: 4000, text: '지난주 이슈 공유드립니다.' },
    ])
  })
})

describe('transcribe', () => {
  test('whisper-cli를 올바른 인자로 실행하고 JSON 출력 파일을 파싱한다', async () => {
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
    expect(segments).toHaveLength(2)
  })
})
