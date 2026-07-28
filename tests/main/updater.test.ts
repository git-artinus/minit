import { EventEmitter } from 'node:events'
import { expect, test, vi } from 'vitest'
import {
  canInstallUpdate,
  classifyUpdateError,
  createUpdater,
  createUpdateNotifier,
  shouldCheckNow,
  FAILED_RETRY_INTERVAL_MS,
  PERIODIC_CHECK_INTERVAL_MS,
  WINDOW_SHOW_MIN_INTERVAL_MS,
  type AutoUpdaterLike,
  type UpdateCheckResult,
  type UpdateNotifier
} from '../../src/main/updater'

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

// 트레이 앱 종료 가드 해제(v0.5.1 버그픽스) — quitAndInstall이 창을 닫을 때 main의 close 핸들러가
// appQuitting=false면 종료 대신 hide해 설치가 행에 걸린다. onBeforeInstall로 quitAndInstall 직전에
// appQuitting=true를 세워 실제 종료→Squirrel 설치·재실행이 진행되게 한다. 순서(before→quit)가 핵심.
test('downloadAndInstall: update-downloaded 시 onBeforeInstall을 quitAndInstall보다 먼저 호출한다', async () => {
  const autoUpdater = fakeAutoUpdater()
  const order: string[] = []
  ;(autoUpdater.quitAndInstall as ReturnType<typeof vi.fn>).mockImplementation(() => {
    order.push('quit')
  })
  const updater = createUpdater({
    autoUpdater,
    isPackaged: () => true,
    onBeforeInstall: () => order.push('before')
  })

  const promise = updater.downloadAndInstall()
  autoUpdater.emit('update-downloaded', {})
  await promise

  expect(order).toEqual(['before', 'quit'])
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

// ── 자동 확인 스케줄·보관 ────────────────────────────────────────────────
// 기존에는 자동 확인이 시작 시 1회뿐이라, 설정에서 [업데이트 확인]을 직접 누르지 않는 한
// 앱을 켜둔 동안에는 새 릴리즈를 알 수 없었다. 이 영역은 회귀가 조용해서(setInterval 한 줄만
// 지워도 사용자는 알 수 없다) 스로틀·보관·실패 집계를 순수 로직으로 뽑아 여기서 못박는다.

test('shouldCheckNow: 간격 직전은 false, 정확히 간격이 지나면 true', () => {
  const now = 1_000_000
  expect(
    shouldCheckNow(now - (WINDOW_SHOW_MIN_INTERVAL_MS - 1), now, WINDOW_SHOW_MIN_INTERVAL_MS)
  ).toBe(false)
  expect(shouldCheckNow(now - WINDOW_SHOW_MIN_INTERVAL_MS, now, WINDOW_SHOW_MIN_INTERVAL_MS)).toBe(
    true
  )
})

test('shouldCheckNow: 한 번도 확인한 적 없으면(0) 즉시 확인한다', () => {
  expect(shouldCheckNow(0, 1_000_000, WINDOW_SHOW_MIN_INTERVAL_MS)).toBe(true)
})

interface NotifierHarness {
  api: UpdateNotifier
  notified: UpdateCheckResult[]
  logs: string[]
  advance: (ms: number) => void
  checkCount: () => number
}

function notifier(
  over: {
    results?: (UpdateCheckResult | Error)[]
    start?: number
  } = {}
): NotifierHarness {
  const queue = [...(over.results ?? [])]
  const notified: UpdateCheckResult[] = []
  const logs: string[] = []
  let clock = over.start ?? 1_000_000
  let checks = 0
  const api = createUpdateNotifier({
    check: async () => {
      checks += 1
      const next = queue.shift() ?? { available: false }
      if (next instanceof Error) throw next
      return next
    },
    notify: (r) => notified.push(r),
    now: () => clock,
    log: (message) => logs.push(message)
  })
  return {
    api,
    notified,
    logs,
    advance: (ms: number) => {
      clock += ms
    },
    checkCount: () => checks
  }
}

const NEW_VERSION: UpdateCheckResult = { available: true, version: '1.0.0' }

test('창 열기: 시작 확인 전(최초 표시)에는 건너뛴다 — 같은 조회를 두 번 하지 않는다', async () => {
  const n = notifier({ results: [NEW_VERSION] })
  await n.api.maybeCheck('window-show')
  expect(n.checkCount()).toBe(0)
  await n.api.maybeCheck('startup')
  expect(n.checkCount()).toBe(1)
})

test('창 열기: 스로틀 안이면 건너뛰고, 지나면 다시 확인한다', async () => {
  const n = notifier()
  await n.api.maybeCheck('startup')
  n.advance(WINDOW_SHOW_MIN_INTERVAL_MS - 1)
  await n.api.maybeCheck('window-show')
  expect(n.checkCount()).toBe(1)
  n.advance(1)
  await n.api.maybeCheck('window-show')
  expect(n.checkCount()).toBe(2)
})

test('주기: 4시간이 지나야 확인한다', async () => {
  const n = notifier()
  await n.api.maybeCheck('startup')
  n.advance(PERIODIC_CHECK_INTERVAL_MS - 1)
  await n.api.maybeCheck('periodic')
  expect(n.checkCount()).toBe(1)
  n.advance(1)
  await n.api.maybeCheck('periodic')
  expect(n.checkCount()).toBe(2)
})

test('새 버전을 찾으면 알리고 보관한다', async () => {
  const n = notifier({ results: [NEW_VERSION] })
  await n.api.maybeCheck('startup')
  expect(n.notified).toEqual([NEW_VERSION])
  expect(n.api.latest()).toEqual(NEW_VERSION)
})

test('새 버전이 없으면 알리지 않는다', async () => {
  const n = notifier({ results: [{ available: false }] })
  await n.api.maybeCheck('startup')
  expect(n.notified).toEqual([])
  expect(n.api.latest()).toBeNull()
})

// 회수(yank)된 릴리즈를 계속 제공하면 릴리즈 노트 링크가 404가 되고 업데이트 버튼은 다운로드 실패로 끝난다.
test('이후 확인이 "없음"을 주면 보관값을 비운다', async () => {
  const n = notifier({ results: [NEW_VERSION, { available: false }] })
  await n.api.maybeCheck('startup')
  expect(n.api.latest()).toEqual(NEW_VERSION)
  n.advance(PERIODIC_CHECK_INTERVAL_MS)
  await n.api.maybeCheck('periodic')
  expect(n.api.latest()).toBeNull()
})

test('수동 확인도 보관값·스탬프를 갱신한다', async () => {
  const n = notifier()
  n.api.recordManualCheck(NEW_VERSION)
  expect(n.api.latest()).toEqual(NEW_VERSION)
  // 스탬프가 섰으므로 창 열기는 스로틀에 걸린다(최초 표시 건너뛰기와 구분된다).
  await n.api.maybeCheck('window-show')
  expect(n.checkCount()).toBe(0)
})

// feed_unreachable은 "업데이트가 없다"는 정보가 아니다 — 이걸로 보관값을 비우면 알림이 사라진다.
test('수동 확인이 feed_unreachable이면 보관값을 건드리지 않는다', () => {
  const n = notifier()
  n.api.recordManualCheck(NEW_VERSION)
  n.api.recordManualCheck({ available: false, error: 'feed_unreachable' })
  expect(n.api.latest()).toEqual(NEW_VERSION)
})

test('실패를 분류·집계하고 로그를 남긴다', async () => {
  const n = notifier({ results: [new Error('getaddrinfo ENOTFOUND api.github.com')] })
  await n.api.maybeCheck('startup')
  expect(n.api.status()).toEqual({
    lastSuccessAt: 0,
    consecutiveFailures: 1,
    lastError: 'feed_unreachable'
  })
  expect(n.logs[0]).toContain('feed_unreachable')
  expect(n.logs[0]).toContain('연속 1회')
})

// 기동 직후의 일시적 실패 하나로 알림이 4시간 막히면 원래 문제를 축소 재현하는 셈이다.
test('실패 뒤에는 4시간을 기다리지 않고 재시도한다', async () => {
  const n = notifier({ results: [new Error('일시 실패'), NEW_VERSION] })
  await n.api.maybeCheck('startup')
  expect(n.api.status().consecutiveFailures).toBe(1)
  n.advance(FAILED_RETRY_INTERVAL_MS)
  await n.api.maybeCheck('periodic')
  expect(n.checkCount()).toBe(2)
  expect(n.api.status().consecutiveFailures).toBe(0)
  expect(n.notified).toEqual([NEW_VERSION])
})

test('성공하면 실패 집계가 초기화된다', async () => {
  const n = notifier({ results: [new Error('a'), new Error('b'), { available: false }] })
  await n.api.maybeCheck('startup')
  n.advance(FAILED_RETRY_INTERVAL_MS)
  await n.api.maybeCheck('periodic')
  expect(n.api.status().consecutiveFailures).toBe(2)
  n.advance(FAILED_RETRY_INTERVAL_MS)
  await n.api.maybeCheck('periodic')
  expect(n.api.status().consecutiveFailures).toBe(0)
  expect(n.api.status().lastSuccessAt).toBeGreaterThan(0)
})

// 실패해도 스탬프는 시도 시점에 선다 — 실패한 피드를 연타하지 않기 위함이다.
test('실패도 스로틀 창을 소모한다', async () => {
  const n = notifier({ results: [new Error('실패')] })
  await n.api.maybeCheck('startup')
  await n.api.maybeCheck('periodic')
  expect(n.checkCount()).toBe(1)
})
