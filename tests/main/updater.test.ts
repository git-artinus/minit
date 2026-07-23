import { EventEmitter } from 'node:events'
import { expect, test, vi } from 'vitest'
import { canInstallUpdate, classifyUpdateError, createUpdater, type AutoUpdaterLike } from '../../src/main/updater'

// 실제 electron-updater의 autoUpdater는 EventEmitter를 상속한다 — 테스트에서도 동일하게
// EventEmitter 기반 페이크로 이벤트 기반 정규화 로직을 검증한다(electron-updater 자체는 주입 목).
function fakeAutoUpdater(): AutoUpdaterLike & EventEmitter {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn()
  }) as unknown as AutoUpdaterLike & EventEmitter
}

test('dev 모드(isPackaged=false)에서는 즉시 { available: false }를 반환하고 실제 체크를 호출하지 않는다', async () => {
  const autoUpdater = fakeAutoUpdater()
  const updater = createUpdater({ autoUpdater, isPackaged: () => false })

  await expect(updater.checkForUpdates()).resolves.toEqual({ available: false })
  expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
})

test('생성 시 autoDownload/autoInstallOnAppQuit를 false로 강제한다', () => {
  const autoUpdater = fakeAutoUpdater()
  createUpdater({ autoUpdater, isPackaged: () => true })

  expect(autoUpdater.autoDownload).toBe(false)
  expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
})

test('update-available 이벤트가 오면 { available: true, version }으로 정규화한다', async () => {
  const autoUpdater = fakeAutoUpdater()
  const updater = createUpdater({ autoUpdater, isPackaged: () => true })

  const promise = updater.checkForUpdates()
  autoUpdater.emit('update-available', { version: '1.2.3' })

  await expect(promise).resolves.toEqual({ available: true, version: '1.2.3' })
})

test('update-not-available 이벤트가 오면 { available: false }로 정규화한다', async () => {
  const autoUpdater = fakeAutoUpdater()
  const updater = createUpdater({ autoUpdater, isPackaged: () => true })

  const promise = updater.checkForUpdates()
  autoUpdater.emit('update-not-available', { version: '1.0.0' })

  await expect(promise).resolves.toEqual({ available: false })
})

test('error 이벤트가 오면 checkForUpdates가 reject한다(호출부가 처리)', async () => {
  const autoUpdater = fakeAutoUpdater()
  const updater = createUpdater({ autoUpdater, isPackaged: () => true })

  const promise = updater.checkForUpdates()
  autoUpdater.emit('error', new Error('네트워크 오류'))

  await expect(promise).rejects.toThrow('네트워크 오류')
})

test('checkForUpdates() 프로미스 자체가 reject하면 동일하게 reject한다', async () => {
  const autoUpdater = fakeAutoUpdater()
  autoUpdater.checkForUpdates = vi.fn().mockRejectedValue(new Error('요청 실패'))
  const updater = createUpdater({ autoUpdater, isPackaged: () => true })

  await expect(updater.checkForUpdates()).rejects.toThrow('요청 실패')
})

test('checkForUpdates 완료 후 남은 리스너를 정리한다(다음 호출과 간섭하지 않음)', async () => {
  const autoUpdater = fakeAutoUpdater()
  const updater = createUpdater({ autoUpdater, isPackaged: () => true })

  const first = updater.checkForUpdates()
  autoUpdater.emit('update-not-available', {})
  await first

  expect(autoUpdater.listenerCount('update-available')).toBe(0)
  expect(autoUpdater.listenerCount('update-not-available')).toBe(0)
  expect(autoUpdater.listenerCount('error')).toBe(0)
})

test('downloadAndInstall: download-progress를 onProgress로 전달하고, update-downloaded 시 quitAndInstall 후 resolve한다', async () => {
  const autoUpdater = fakeAutoUpdater()
  const updater = createUpdater({ autoUpdater, isPackaged: () => true })
  const progressEvents: unknown[] = []

  const promise = updater.downloadAndInstall((p) => progressEvents.push(p))
  autoUpdater.emit('download-progress', { percent: 50, transferred: 50, total: 100 })
  autoUpdater.emit('update-downloaded', {})
  await promise

  expect(progressEvents).toEqual([{ percent: 50, transferred: 50, total: 100 }])
  expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
})

test('downloadAndInstall: error 이벤트가 오면 reject하고 quitAndInstall을 호출하지 않는다', async () => {
  const autoUpdater = fakeAutoUpdater()
  const updater = createUpdater({ autoUpdater, isPackaged: () => true })

  const promise = updater.downloadAndInstall()
  autoUpdater.emit('error', new Error('다운로드 실패'))

  await expect(promise).rejects.toThrow('다운로드 실패')
  expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
})

test('downloadAndInstall: downloadUpdate() 프로미스 자체가 reject하면 동일하게 reject한다', async () => {
  const autoUpdater = fakeAutoUpdater()
  autoUpdater.downloadUpdate = vi.fn().mockRejectedValue(new Error('시작 실패'))
  const updater = createUpdater({ autoUpdater, isPackaged: () => true })

  await expect(updater.downloadAndInstall()).rejects.toThrow('시작 실패')
})

test('downloadAndInstall: onProgress 콜백 없이도 정상 동작한다', async () => {
  const autoUpdater = fakeAutoUpdater()
  const updater = createUpdater({ autoUpdater, isPackaged: () => true })

  const promise = updater.downloadAndInstall()
  autoUpdater.emit('update-downloaded', {})

  await expect(promise).resolves.toBeUndefined()
})

// 설치 가드(리뷰 Fix Critical) — 녹음·파이프라인 처리 중 quitAndInstall로 인한 강제 재시작을
// 막는다. main(ipc.ts)이 이 순수 함수 결과로 update:download를 던지기 전에 차단한다.
test('canInstallUpdate: 녹음 중이 아니고 실행 중인 파이프라인이 없으면 ok:true를 반환한다', () => {
  expect(canInstallUpdate({ isRecording: false, runningPipelineCount: 0 })).toEqual({ ok: true })
})

test('canInstallUpdate: 녹음 중이면 ok:false, reason:recording_in_progress를 반환한다', () => {
  expect(canInstallUpdate({ isRecording: true, runningPipelineCount: 0 })).toEqual({
    ok: false,
    reason: 'recording_in_progress'
  })
})

test('canInstallUpdate: 녹음 중이 아니어도 실행 중인 파이프라인이 있으면 ok:false, reason:pipeline_in_progress를 반환한다', () => {
  expect(canInstallUpdate({ isRecording: false, runningPipelineCount: 1 })).toEqual({
    ok: false,
    reason: 'pipeline_in_progress'
  })
})

// 저장소 비공개 상태 업데이트 안내(v0.4.1) — GitHub Releases 피드는 레포가 public이어야 응답한다.
// private 동안 발생하는 404/HttpError/ENOTFOUND/ECONNREFUSED/rate limit 계열 오류를 하나로
// 묶어 렌더러가 "안내" 톤으로 보여줄 수 있게 분류한다.
test('classifyUpdateError: HttpError(404, latest-mac.yml 없음)는 feed_unreachable로 분류한다', () => {
  class HttpError extends Error {
    statusCode: number
    constructor(statusCode: number, message: string) {
      super(message)
      this.name = 'HttpError'
      this.statusCode = statusCode
    }
  }
  const err = new HttpError(404, 'HttpError: 404(Not Found) latest-mac.yml')

  expect(classifyUpdateError(err)).toBe('feed_unreachable')
})

test('classifyUpdateError: ENOTFOUND(DNS 조회 실패)는 feed_unreachable로 분류한다', () => {
  const err = new Error('getaddrinfo ENOTFOUND api.github.com')

  expect(classifyUpdateError(err)).toBe('feed_unreachable')
})

test('classifyUpdateError: rate limit 오류는 feed_unreachable로 분류한다', () => {
  const err = new Error('API rate limit exceeded for installation')

  expect(classifyUpdateError(err)).toBe('feed_unreachable')
})

test('classifyUpdateError: 위 패턴에 해당하지 않는 오류는 other로 분류한다', () => {
  expect(classifyUpdateError(new Error('알 수 없는 파싱 오류'))).toBe('other')
  expect(classifyUpdateError('문자열 오류')).toBe('other')
})
