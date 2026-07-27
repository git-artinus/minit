import { describe, expect, test, vi } from 'vitest'
import {
  pullRemoteMeetings,
  retryPendingDeletes,
  retryPendingDeletesAndSave,
  retryPendingUploads,
  retryPendingUploadsAndSave,
  shouldPull,
  syncMeeting
} from '../../../src/main/github/sync'

describe('syncMeeting', () => {
  test('정상 경로: upload를 호출하고 onFailure는 호출하지 않는다', async () => {
    const upload = vi.fn(async () => undefined)
    const onFailure = vi.fn()
    const log = vi.fn()

    syncMeeting({
      filename: 'a.md',
      content: '내용',
      token: 't',
      repo: 'owner/repo',
      upload,
      fetchImpl: fetch,
      onFailure,
      log
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(upload).toHaveBeenCalledWith('t', 'owner/repo', 'a.md', '내용', fetch)
    expect(onFailure).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  test('upload가 reject해도 함수 자체는 throw하지 않고 onFailure(filename)를 호출한다', async () => {
    const upload = vi.fn(async () => {
      throw new Error('네트워크 오류')
    })
    const onFailure = vi.fn()
    const log = vi.fn()

    expect(() =>
      syncMeeting({ filename: 'a.md', content: '내용', token: 't', repo: 'owner/repo', upload, fetchImpl: fetch, onFailure, log })
    ).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    expect(onFailure).toHaveBeenCalledWith('a.md')
    expect(log).toHaveBeenCalledTimes(1)
  })

  test('upload 호출 자체가 동기 throw해도 함수는 throw하지 않는다', () => {
    const upload = vi.fn(() => {
      throw new Error('동기 실패')
    })
    const onFailure = vi.fn()
    const log = vi.fn()

    expect(() =>
      syncMeeting({ filename: 'a.md', content: '내용', token: 't', repo: 'owner/repo', upload: upload as never, fetchImpl: fetch, onFailure, log })
    ).not.toThrow()
    expect(onFailure).toHaveBeenCalledWith('a.md')
    expect(log).toHaveBeenCalledTimes(1)
  })
})

describe('retryPendingUploads', () => {
  test('큐의 모든 파일을 업로드하고 성공한 파일명 배열을 반환한다', async () => {
    const upload = vi.fn(async () => undefined)
    const readContent = vi.fn((filename: string) => `content of ${filename}`)
    const log = vi.fn()

    const succeeded = await retryPendingUploads({
      pending: ['a.md', 'b.md'],
      token: 't',
      repo: 'owner/repo',
      readContent,
      upload,
      fetchImpl: fetch,
      log
    })

    expect(succeeded).toEqual(['a.md', 'b.md'])
    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload).toHaveBeenCalledWith('t', 'owner/repo', 'a.md', 'content of a.md', fetch)
  })

  test('일부만 실패하면 성공한 파일명만 반환한다(실패분은 제외)', async () => {
    const upload = vi.fn(async (_t: string, _r: string, filename: string) => {
      if (filename === 'fail.md') throw new Error('실패')
    })
    const readContent = vi.fn((filename: string) => `content of ${filename}`)
    const log = vi.fn()

    const succeeded = await retryPendingUploads({
      pending: ['ok.md', 'fail.md'],
      token: 't',
      repo: 'owner/repo',
      readContent,
      upload,
      fetchImpl: fetch,
      log
    })

    expect(succeeded).toEqual(['ok.md'])
    expect(log).toHaveBeenCalledTimes(1)
  })

  test('원본 파일이 사라졌으면(readContent가 null) 재시도 불가로 성공 취급해 반환한다(큐에서 제거됨)', async () => {
    const upload = vi.fn(async () => undefined)
    const readContent = vi.fn(() => null)
    const log = vi.fn()

    const succeeded = await retryPendingUploads({
      pending: ['gone.md'],
      token: 't',
      repo: 'owner/repo',
      readContent,
      upload,
      fetchImpl: fetch,
      log
    })

    expect(succeeded).toEqual(['gone.md'])
    expect(upload).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  test('pending이 비어 있으면 아무 것도 하지 않는다', async () => {
    const upload = vi.fn()
    const succeeded = await retryPendingUploads({
      pending: [],
      token: 't',
      repo: 'owner/repo',
      readContent: vi.fn(),
      upload,
      fetchImpl: fetch,
      log: vi.fn()
    })
    expect(succeeded).toEqual([])
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('retryPendingUploadsAndSave', () => {
  test('재시도 도중(각 업로드 사이) 큐에 새 항목이 추가돼도 유실 없이 병합한다(레이스 재현)', async () => {
    // pipeline:run이 별도로 실패해 pendingUploads에 새 항목을 추가하는 시나리오를, upload 훅
    // 안에서 "저장소(currentPending)"를 직접 변형해 재현한다 — 실제로는 서로 다른 IPC 핸들러가
    // settings 변수를 공유하며 벌이는 경합이다.
    let currentPending = ['a.md', 'b.md']
    const savePending = vi.fn((updated: string[]) => {
      currentPending = updated
    })
    const upload = vi.fn(async (_t: string, _r: string, filename: string) => {
      if (filename === 'a.md') {
        // a.md 업로드가 완료된 시점에 동시성 있게 새 pendingUpload가 추가된 상황을 재현.
        currentPending = [...currentPending, 'new-during-retry.md']
      }
    })
    const readContent = vi.fn((filename: string) => `content of ${filename}`)

    await retryPendingUploadsAndSave({
      pending: ['a.md', 'b.md'],
      token: 't',
      repo: 'owner/repo',
      readContent,
      upload,
      fetchImpl: fetch,
      log: vi.fn(),
      getCurrentPending: () => currentPending,
      savePending
    })

    expect(savePending).toHaveBeenCalledTimes(1)
    expect(currentPending).toEqual(['new-during-retry.md'])
  })

  test('성공한 항목이 없으면 저장을 호출하지 않는다', async () => {
    const savePending = vi.fn()
    const upload = vi.fn(async () => {
      throw new Error('실패')
    })

    await retryPendingUploadsAndSave({
      pending: ['fail.md'],
      token: 't',
      repo: 'owner/repo',
      readContent: vi.fn(() => 'content'),
      upload,
      fetchImpl: fetch,
      log: vi.fn(),
      getCurrentPending: () => ['fail.md'],
      savePending
    })

    expect(savePending).not.toHaveBeenCalled()
  })

  test('성공분이 최신 큐에 이미 없으면(중복 제거 등) 저장을 호출하지 않는다', async () => {
    const savePending = vi.fn()
    const upload = vi.fn(async () => undefined)

    await retryPendingUploadsAndSave({
      pending: ['a.md'],
      token: 't',
      repo: 'owner/repo',
      readContent: vi.fn(() => 'content'),
      upload,
      fetchImpl: fetch,
      log: vi.fn(),
      getCurrentPending: () => [], // 이미 다른 경로로 제거된 상태
      savePending
    })

    expect(savePending).not.toHaveBeenCalled()
  })
})

describe('pullRemoteMeetings', () => {
  test('로컬에 없는 원격 파일만 다운로드해 저장하고 저장된 파일명을 반환한다', async () => {
    const listRemote = vi.fn(async () => [{ name: 'a.md', sha: 's1' }, { name: 'b.md', sha: 's2' }])
    const download = vi.fn(async (filename: string) => `content of ${filename}`)
    const localExists = vi.fn((filename: string) => filename === 'a.md')
    const writeLocal = vi.fn()
    const log = vi.fn()

    const saved = await pullRemoteMeetings({ listRemote, download, localExists, isDeleted: () => false, writeLocal, log })

    expect(saved).toEqual(['b.md'])
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith('b.md')
    expect(writeLocal).toHaveBeenCalledWith('b.md', 'content of b.md')
    expect(log).not.toHaveBeenCalled()
  })

  test('삭제 재시도 대기 중인 파일은 원격에 남아 있어도 내려받지 않는다', async () => {
    const listRemote = vi.fn(async () => [{ name: 'deleted.md', sha: 's1' }, { name: 'keep.md', sha: 's2' }])
    const download = vi.fn(async (filename: string) => `content of ${filename}`)
    const writeLocal = vi.fn()

    const saved = await pullRemoteMeetings({
      listRemote,
      download,
      localExists: () => false,
      isDeleted: (filename: string) => filename === 'deleted.md',
      writeLocal,
      log: vi.fn()
    })

    expect(saved).toEqual(['keep.md'])
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith('keep.md')
  })

  test('로컬에 같은 파일명이 있으면 절대 덮어쓰지 않는다(다운로드 자체를 하지 않는다)', async () => {
    const listRemote = vi.fn(async () => [{ name: 'a.md', sha: 's1' }])
    const download = vi.fn()
    const localExists = vi.fn(() => true)
    const writeLocal = vi.fn()

    const saved = await pullRemoteMeetings({ listRemote, download, localExists, isDeleted: () => false, writeLocal, log: vi.fn() })

    expect(saved).toEqual([])
    expect(download).not.toHaveBeenCalled()
    expect(writeLocal).not.toHaveBeenCalled()
  })

  test('목록 조회 실패 시 throw하지 않고 빈 배열을 반환한다(로그만)', async () => {
    const listRemote = vi.fn(async () => {
      throw new Error('네트워크 오류')
    })
    const log = vi.fn()

    const saved = await pullRemoteMeetings({
      listRemote,
      download: vi.fn(),
      isDeleted: () => false,
      localExists: vi.fn(),
      writeLocal: vi.fn(),
      log
    })

    expect(saved).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
  })

  test('개별 파일 다운로드 실패는 격리되고 나머지는 계속 진행한다', async () => {
    const listRemote = vi.fn(async () => [{ name: 'ok.md', sha: 's1' }, { name: 'fail.md', sha: 's2' }])
    const download = vi.fn(async (filename: string) => {
      if (filename === 'fail.md') throw new Error('다운로드 실패')
      return `content of ${filename}`
    })
    const writeLocal = vi.fn()
    const log = vi.fn()

    const saved = await pullRemoteMeetings({
      listRemote,
      download,
      isDeleted: () => false,
      localExists: vi.fn(() => false),
      writeLocal,
      log
    })

    expect(saved).toEqual(['ok.md'])
    expect(writeLocal).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
  })

  test('원격 목록이 비어 있으면 아무 것도 하지 않는다', async () => {
    const download = vi.fn()
    const writeLocal = vi.fn()

    const saved = await pullRemoteMeetings({
      listRemote: vi.fn(async () => []),
      download,
      isDeleted: () => false,
      localExists: vi.fn(),
      writeLocal,
      log: vi.fn()
    })

    expect(saved).toEqual([])
    expect(download).not.toHaveBeenCalled()
    expect(writeLocal).not.toHaveBeenCalled()
  })

  test('writeLocal이 EEXIST 예외를 던지면(레이스에서 로컬 승리) 해당 파일을 스킵하고 반환 목록에서 제외한다', async () => {
    const listRemote = vi.fn(async () => [
      { name: 'a.md', sha: 's1' },
      { name: 'b.md', sha: 's2' }
    ])
    const download = vi.fn(async (filename: string) => `content of ${filename}`)
    const writeLocal = vi.fn((filename: string) => {
      if (filename === 'a.md') {
        const err = new Error('EEXIST: file already exists') as NodeJS.ErrnoException
        err.code = 'EEXIST'
        throw err
      }
    })
    const log = vi.fn()

    const saved = await pullRemoteMeetings({
      listRemote,
      download,
      isDeleted: () => false,
      localExists: () => false,
      writeLocal,
      log
    })

    expect(saved).toEqual(['b.md'])
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toMatch(/로컬|레이스|스킵/)
  })

  test('writeLocal의 EEXIST 이외 예외는 일반 다운로드 실패와 동일하게 격리된다', async () => {
    const listRemote = vi.fn(async () => [{ name: 'a.md', sha: 's1' }])
    const download = vi.fn(async (filename: string) => `content of ${filename}`)
    const writeLocal = vi.fn(() => {
      throw new Error('디스크 오류')
    })
    const log = vi.fn()

    const saved = await pullRemoteMeetings({
      listRemote,
      download,
      isDeleted: () => false,
      localExists: () => false,
      writeLocal,
      log
    })

    expect(saved).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
  })

  test('동시에 최대 4개까지만 병렬로 다운로드한다', async () => {
    const remoteFiles = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.md`, sha: `s${i}` }))
    let inFlight = 0
    let maxInFlight = 0
    const resolvers: Array<() => void> = []
    const download = vi.fn(
      (filename: string) =>
        new Promise<string>((resolve) => {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          resolvers.push(() => {
            inFlight--
            resolve(`content of ${filename}`)
          })
        })
    )

    const promise = pullRemoteMeetings({
      listRemote: async () => remoteFiles,
      download,
      isDeleted: () => false,
      localExists: () => false,
      writeLocal: vi.fn(),
      log: vi.fn()
    })

    // listRemote의 마이크로태스크가 진행되어 워커 풀이 시작될 시간을 준다.
    await new Promise((r) => setTimeout(r, 0))
    expect(maxInFlight).toBe(4)
    expect(download).toHaveBeenCalledTimes(4)

    while (resolvers.length > 0) {
      resolvers.shift()!()
      await new Promise((r) => setTimeout(r, 0))
    }

    await promise
    expect(download).toHaveBeenCalledTimes(6)
  })

  test('1주기 최대 30파일 상한 — 초과분은 다음 주기로 이월하고 로그를 남긴다', async () => {
    const remoteFiles = Array.from({ length: 35 }, (_, i) => ({ name: `f${i}.md`, sha: `s${i}` }))
    const download = vi.fn(async (filename: string) => `content of ${filename}`)
    const writeLocal = vi.fn()
    const log = vi.fn()

    const saved = await pullRemoteMeetings({
      listRemote: async () => remoteFiles,
      download,
      isDeleted: () => false,
      localExists: () => false,
      writeLocal,
      log
    })

    expect(saved).toHaveLength(30)
    expect(download).toHaveBeenCalledTimes(30)
    expect(log.mock.calls.some((call) => String(call[0]).includes('상한'))).toBe(true)
  })
})

describe('shouldPull', () => {
  test('마지막 pull 이후 간격(intervalMs)이 지나지 않았으면 false', () => {
    expect(shouldPull(1_000, 1_000 + 59_999, 60_000)).toBe(false)
  })

  test('간격이 지났으면 true', () => {
    expect(shouldPull(1_000, 1_000 + 60_000, 60_000)).toBe(true)
  })

  test('한 번도 pull한 적 없으면(lastPulledAt=0) 간격과 무관하게 즉시 true', () => {
    expect(shouldPull(0, 1, 60_000)).toBe(true)
  })

  test('intervalMs 기본값은 60000ms', () => {
    expect(shouldPull(1_000, 1_000 + 59_999)).toBe(false)
    expect(shouldPull(1_000, 1_000 + 60_000)).toBe(true)
  })
})

describe('retryPendingDeletes', () => {
  test('원격 삭제에 성공한 파일명만 반환한다', async () => {
    const deleteRemote = vi.fn(async (_t: string, _r: string, filename: string) => {
      if (filename === 'fail.md') throw new Error('네트워크 오류')
    })
    const log = vi.fn()

    const succeeded = await retryPendingDeletes({
      pending: ['a.md', 'fail.md', 'b.md'],
      token: 't',
      repo: 'owner/repo',
      deleteRemote,
      fetchImpl: fetch,
      log
    })

    expect(succeeded).toEqual(['a.md', 'b.md'])
    expect(deleteRemote).toHaveBeenCalledTimes(3)
    expect(log).toHaveBeenCalledTimes(1)
  })

  test('유효하지 않은 파일명은 원격 호출 없이 큐에서 제거한다', async () => {
    const deleteRemote = vi.fn(async () => undefined)

    const succeeded = await retryPendingDeletes({
      pending: ['../secret.md'],
      token: 't',
      repo: 'owner/repo',
      deleteRemote,
      fetchImpl: fetch,
      log: vi.fn()
    })

    expect(succeeded).toEqual(['../secret.md'])
    expect(deleteRemote).not.toHaveBeenCalled()
  })
})

describe('retryPendingDeletesAndSave', () => {
  test('재시도 도중 큐에 추가된 항목을 유실하지 않고 성공분만 제거한다', async () => {
    let currentPending = ['a.md', 'b.md']
    const savePending = vi.fn((updated: string[]) => {
      currentPending = updated
    })
    const deleteRemote = vi.fn(async (_t: string, _r: string, filename: string) => {
      if (filename === 'a.md') currentPending = [...currentPending, 'new-during-retry.md']
    })

    await retryPendingDeletesAndSave({
      pending: ['a.md', 'b.md'],
      token: 't',
      repo: 'owner/repo',
      deleteRemote,
      fetchImpl: fetch,
      log: vi.fn(),
      getCurrentPending: () => currentPending,
      savePending
    })

    expect(savePending).toHaveBeenCalledTimes(1)
    expect(currentPending).toEqual(['new-during-retry.md'])
  })

  test('성공한 항목이 없으면 저장을 호출하지 않는다', async () => {
    const savePending = vi.fn()

    await retryPendingDeletesAndSave({
      pending: ['fail.md'],
      token: 't',
      repo: 'owner/repo',
      deleteRemote: vi.fn(async () => {
        throw new Error('실패')
      }),
      fetchImpl: fetch,
      log: vi.fn(),
      getCurrentPending: () => ['fail.md'],
      savePending
    })

    expect(savePending).not.toHaveBeenCalled()
  })
})
