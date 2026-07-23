import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  appendChunk, isValidRecordingId, listRecoverable, readRecording, removeRecording,
} from '../../src/main/recording-sink'

test('chunk를 append하고, 복구 목록에 나타나고, 삭제하면 사라진다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-rec-'))
  appendChunk(dir, 'rec1', Buffer.from([1, 2]))
  appendChunk(dir, 'rec1', Buffer.from([3]))
  expect(listRecoverable(dir)).toEqual(['rec1'])
  expect(readRecording(dir, 'rec1')).toEqual(Buffer.from([1, 2, 3]))
  removeRecording(dir, 'rec1')
  expect(listRecoverable(dir)).toEqual([])
})

test('recordings 디렉토리가 없어도 동작한다', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-rec-')), 'none')
  expect(listRecoverable(dir)).toEqual([])
  appendChunk(dir, 'rec1', Buffer.from([9]))   // 디렉토리 자동 생성
  expect(listRecoverable(dir)).toEqual(['rec1'])
})

test('isValidRecordingId: crypto.randomUUID() 형식은 통과한다', () => {
  expect(isValidRecordingId('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBe(true)
})

test('isValidRecordingId: path traversal·구분자·빈 문자열·길이 초과는 거부한다', () => {
  expect(isValidRecordingId('../x')).toBe(false)
  expect(isValidRecordingId('a/b')).toBe(false)
  expect(isValidRecordingId('a\\b')).toBe(false)
  expect(isValidRecordingId('')).toBe(false)
  expect(isValidRecordingId('a'.repeat(65))).toBe(false)
})

test('isValidRecordingId: 64자 이하의 영숫자·하이픈 조합은 통과한다', () => {
  expect(isValidRecordingId('a'.repeat(64))).toBe(true)
})

test("isValidRecordingId: '.'을 포함한 문자열은 정규식(/^[A-Za-z0-9-]{1,64}$/)에 없으므로 거부한다", () => {
  expect(isValidRecordingId('x..y')).toBe(false)
})
