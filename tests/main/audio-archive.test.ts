import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { archiveRecording, sweepArchive } from '../../src/main/audio-archive'

let base: string
let rec: string
let arch: string
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'minit-arch-'))
  rec = path.join(base, 'recordings'); arch = path.join(base, 'audio-archive')
  fs.mkdirSync(rec, { recursive: true })
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

describe('archiveRecording', () => {
  test('webm을 recordings에서 archive로 이동한다', () => {
    fs.writeFileSync(path.join(rec, 'abc.webm'), 'audio')
    archiveRecording(rec, arch, 'abc')
    expect(fs.existsSync(path.join(rec, 'abc.webm'))).toBe(false)
    expect(fs.readFileSync(path.join(arch, 'abc.webm'), 'utf-8')).toBe('audio')
  })
  test('원본이 없으면 조용히 무시한다', () => {
    expect(() => archiveRecording(rec, arch, 'missing')).not.toThrow()
  })
})

describe('sweepArchive', () => {
  test('TTL을 넘긴 파일만 삭제한다', () => {
    fs.mkdirSync(arch, { recursive: true })
    const old = path.join(arch, 'old.webm'); const fresh = path.join(arch, 'fresh.webm')
    fs.writeFileSync(old, 'x'); fs.writeFileSync(fresh, 'y')
    const now = 10_000_000_000
    fs.utimesSync(old, new Date(now), new Date(now - 8 * 86_400_000))
    fs.utimesSync(fresh, new Date(now), new Date(now - 1 * 86_400_000))
    sweepArchive(arch, 7 * 86_400_000, now)
    expect(fs.existsSync(old)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
  })
  test('아카이브 디렉토리가 없어도 throw하지 않는다', () => {
    expect(() => sweepArchive(arch, 1000, Date.now())).not.toThrow()
  })
})
