import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { downloadModel, modelUrl } from '../../src/main/model-download'

test('modelUrl: HuggingFace resolve URL', () => {
  expect(modelUrl('ggml-large-v3-turbo.bin'))
    .toBe('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin')
})

test('downloadModel: 스트림을 받아 완료 시에만 최종 경로에 생긴다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-'))
  const dest = path.join(dir, 'models', 'm.bin')
  const body = new Blob([new Uint8Array([1, 2, 3, 4])])
  const fetchImpl = (async () =>
    new Response(body.stream(), { headers: { 'content-length': '4' } })) as typeof fetch
  const progress: number[] = []
  await downloadModel({ url: 'http://x', destPath: dest, fetchImpl, onProgress: (r) => progress.push(r) })
  expect(fs.readFileSync(dest)).toEqual(Buffer.from([1, 2, 3, 4]))
  expect(fs.existsSync(dest + '.part')).toBe(false)
  expect(progress.at(-1)).toBe(4)
})

test('downloadModel: 스트림이 중간에 실패하면 거부하고 .part/최종 파일을 남기지 않는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-'))
  const dest = path.join(dir, 'models', 'm.bin')
  let pullCount = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1
      if (pullCount === 1) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]))
        return
      }
      controller.error(new Error('시뮬레이션된 스트림 오류'))
    },
  })
  const fetchImpl = (async () =>
    new Response(body, { headers: { 'content-length': '999' } })) as typeof fetch

  await expect(
    downloadModel({ url: 'http://x', destPath: dest, fetchImpl }),
  ).rejects.toThrow()

  expect(fs.existsSync(dest + '.part')).toBe(false)
  expect(fs.existsSync(dest)).toBe(false)
})

test('downloadModel: HTTP 오류 응답이면 .part 생성 전에 거부한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-'))
  const dest = path.join(dir, 'models', 'm.bin')
  const fetchImpl = (async () => new Response(null, { status: 500 })) as typeof fetch

  await expect(
    downloadModel({ url: 'http://x', destPath: dest, fetchImpl }),
  ).rejects.toThrow(/HTTP 500/)

  expect(fs.existsSync(dest + '.part')).toBe(false)
  expect(fs.existsSync(dest)).toBe(false)
})
