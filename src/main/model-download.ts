import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export function modelUrl(modelName: string): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`
}

export async function downloadModel(deps: {
  url: string
  destPath: string
  fetchImpl: typeof fetch
  onProgress?: (received: number, total: number) => void
}): Promise<void> {
  const res = await deps.fetchImpl(deps.url)
  if (!res.ok || !res.body) throw new Error(`모델 다운로드 실패: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  fs.mkdirSync(path.dirname(deps.destPath), { recursive: true })
  const partPath = deps.destPath + '.part'

  let received = 0
  const progressTransform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      deps.onProgress?.(received, total)
      callback(null, chunk)
    },
  })
  const source = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)

  try {
    // pipeline은 소스·변환·목적지(쓰기 스트림) 전체의 에러를 한 곳에서 감지하고
    // 백프레셔(드레인 대기)까지 처리하므로, 쓰기 실패(ENOSPC 등)도 이 promise의 reject로 이어진다.
    await pipeline(source, progressTransform, fs.createWriteStream(partPath))
    fs.renameSync(partPath, deps.destPath)
  } catch (e) {
    fs.rmSync(partPath, { force: true })
    throw e
  }
}
