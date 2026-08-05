import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, clipboard, dialog, ipcMain, safeStorage, shell, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { checkEnv, modelFilePath, resolveWhisperCli, systemCommandExists } from './env-check'
import { downloadModel, modelUrl } from './model-download'
import {
  canInstallUpdate, classifyUpdateError, createUpdater, createUpdateNotifier,
  CHECK_TICK_MS, STARTUP_CHECK_DELAY_MS,
  type AutoUpdaterLike
} from './updater'
import * as sink from './recording-sink'
import { archiveRecording } from './audio-archive'
import { minitHome, saveSettings } from './settings'
import { initializeSettings } from './settings-init'
import { runPipeline } from './pipeline/pipeline'
import { transcribeAndRepair } from './pipeline/transcriber'
import { summarize } from './pipeline/summarizer'
import { deleteMeeting, isGitRepo, loadMeetings, pushPending, saveMeeting, systemGit } from './pipeline/storage'
import { runWithStdin } from './pipeline/claude-run'
import { classifyClaudeFailure } from './pipeline/summary-error'
import { availabilityEvidence, createClaudeStatusChecker, probeClaude } from './claude-status'
import { regenerateSummary } from './pipeline/regenerate'
import {
  addParticipants, dedupeAndSort, loadRoster, mergeNames, parseImportInput,
  removeParticipant, renameParticipant, saveRoster, seedRosterIfMissing,
} from './roster'
import { collectParticipants } from '../shared/meeting-query'
import { meetingTypeDef } from '../shared/meeting-types'
import { buildPostMessageBody, defaultSlackChannelId, listChannels, listUsers, notifySlackForMeeting, postChatMessage, resolveSlackChannelId } from './slack'
import { deleteSlackMembers, loadSlackMembers, saveSlackMembers } from './slack-members-store'
import { pollForToken, requestDeviceCode } from './github/device-flow'
import { createLoginSessionManager } from './github/login-session'
import { deleteToken as deleteGithubToken, loadToken as loadGithubToken, saveToken as saveGithubToken } from './github/token-store'
import {
  deleteToken as deleteSlackToken,
  loadToken as loadSlackToken,
  migrateLegacySlackToken,
  saveToken as saveSlackToken
} from './slack-token-store'
import {
  deleteRemoteMeeting,
  downloadRemoteMeeting,
  fetchViewer,
  listRemoteMeetings,
  listRepos as listGithubRepos,
  uploadMeeting
} from './github/api'
import {
  pullRemoteMeetings,
  retryPendingDeletesAndSave,
  retryPendingUploadsAndSave,
  shouldPull,
  syncMeeting
} from './github/sync'
import { isValidMeetingFilename, parseMeeting, serializeMeeting } from '../shared/meeting-file'
import { exportContent, exportFileName, type ExportFormat } from '../shared/share-format'
import type {
  AppSettings,
  AutoCheckStatus,
  GithubLoginState,
  Meeting,
  MeetingMeta,
  RegenerateResult,
  Roster,
  SlackChannel,
  SlackMember,
  SlackMembersState,
  SlackSendFailure,
  SlackTokenState,
  UpdateCheckResult
} from '../shared/types'

const execFileP = promisify(execFile)

const runningPipelines = new Set<string>()

// GitHub Device Flow 로그인 세션 관리(리뷰 Fix 3) — 새 startLogin 호출·명시적 cancelLogin 모두
// 이전 세션을 무효화해 경합을 막는다. registerIpc는 앱 생명주기 동안 1회만 호출되므로 모듈
// 레벨 인스턴스 하나로 충분하다.
const loginSessionManager = createLoginSessionManager()

const GITHUB_REPO_RE = /^[\w.-]+\/[\w.-]+$/

export function registerIpc(
  win: BrowserWindow,
  opts: { onRecordingState: (r: boolean) => void; onBeforeInstall?: () => void }
): void {
  const userData = app.getPath('userData')
  const configDir = minitHome()
  // 자동 발송 실패는 조용히 넘기지 않고 알린다 — 사용자는 회의록이 공유된 줄 안다. 재시도는
  // 하지 않는다(회의록 상세의 공유 모달로 직접 다시 보낼 수 있다).
  const sendSlackFailureNotice = (failure: SlackSendFailure): void => {
    if (!win.isDestroyed()) win.webContents.send('slack:send-failed', failure)
  }
  // 레거시 설정 파일 위치 이전(userData → ~/.minit) → 레거시 평문 Slack 토큰 암호화 이관 →
  // 최종 Settings 로드, 이 순서 의존을 initializeSettings 함수 자체가 못박는다(리뷰 Fix 2 —
  // registerIpc는 electron 의존이라 ipc 테스트 하네스가 없으므로, 순서 검증은 이 함수의
  // 단위 테스트가 대신한다).
  const readSlackSettingsFile = (p: string): string | null => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null)
  const writeSlackSettingsFile = (p: string, content: string): void => fs.writeFileSync(p, content)
  let settings = initializeSettings({
    legacyUserDataDir: userData,
    configDir,
    tokenStoreFs: fs,
    safeStorage,
    readSettingsFile: readSlackSettingsFile,
    writeSettingsFile: writeSlackSettingsFile
  })
  // ── Slack 멤버(회의 참석자 후보) ────────────────────────────────────────
  // 기동 초기화·IPC 핸들러가 모두 쓰므로 둘보다 먼저 선언한다(const라 TDZ에 걸린다).
  const readSlackMembers = (): SlackMember[] =>
    loadSlackMembers(configDir, fs.existsSync, (p) => fs.readFileSync(p, 'utf-8')).members

  // 동기화 실패는 흡수하고 기존 저장분을 유지한다 — 오프라인·스코프 미보유에서도 회의 시작
  // 화면이 동작해야 한다. 실패 사유는 설정 화면 안내용으로 error에 담아 돌려준다.
  const syncSlackMembers = async (): Promise<SlackMembersState> => {
    const stored = loadSlackMembers(configDir, fs.existsSync, (p) => fs.readFileSync(p, 'utf-8'))
    const token = loadSlackToken(configDir, { fs, safeStorage })
    if (!token) return { ...stored, error: 'Slack 봇 토큰이 등록되어 있지 않습니다' }

    try {
      const members = await listUsers(token, fetch)
      const saved = saveSlackMembers(configDir, members, new Date().toISOString(), (p, content) =>
        fs.writeFileSync(p, content)
      )
      return { ...saved, error: null }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[slack] 멤버 동기화 실패:', message)
      return { ...stored, error: message }
    }
  }

  // GitHub 원격 pull 스로틀 상태(모듈이 아닌 registerIpc 클로저 — 앱 생명주기 동안 1회만
  // 호출되므로 loginSessionManager와 동일하게 여기 하나로 충분하다). 0=한 번도 pull한 적 없음.
  let lastPulledAt = 0
  // 리뷰 Fix 2(Important) — 스로틀 리셋: 레포 변경·로그아웃·재로그인 성공 등 "이전 스로틀 상태를
  // 신뢰할 수 없게 되는" 시점에 호출해 다음 meetings:list에서 즉시 pull이 실행되도록 한다.
  const resetPullThrottle = (): void => {
    lastPulledAt = 0
  }
  // 기록자(recorder, v0.4.0 ③b) — GitHub 로그인 login명 캐시. pipeline:run은 이 값을 그대로
  // 읽기만 할 뿐 fetchViewer를 재호출하지 않는다(네트워크 재호출 최소화). github:loginState 조회
  // 성공·로그인 성공 이벤트가 갱신하고, 로그아웃·조회 실패 시 비운다.
  let cachedGithubLogin: string | undefined
  void (async (): Promise<void> => {
    const token = loadGithubToken(configDir, { fs, safeStorage })
    if (!token) return
    try {
      cachedGithubLogin = (await fetchViewer(token, fetch)).login
    } catch {
      // 앱 기동 시점의 워밍업 실패는 무시 — 이후 github:loginState 호출 시 재시도된다.
    }
  })()
  // 개인 로스터 최초 시드(v0.4.0 ③a) — ~/.minit/participants.json이 아직 없으면 기존
  // 회의록 참석자로 1회 시드한다. 실패해도 roster:get이 null 폴백하므로 앱 기동을 막지 않는다.
  void (async (): Promise<void> => {
    try {
      // Fix 2: 파일이 이미 있으면 loadMeetings 스캔 생략
      const file = path.join(configDir, 'participants.json')
      if (fs.existsSync(file)) return

      const existingMeetings = await loadMeetings(settings.repoRoot)
      seedRosterIfMissing(configDir, {
        fileExists: fs.existsSync,
        readFile: (p) => fs.readFileSync(p, 'utf-8'),
        writeFile: (p, content) => fs.writeFileSync(p, content),
        collectExistingParticipants: () => collectParticipants(existingMeetings),
      })
    } catch (e) {
      console.error('[roster] 최초 시드 실패:', e instanceof Error ? e.message : e)
    }
  })()
  // Slack 멤버 목록 기동 시 1회 갱신 — 실측 407ms라 화면을 막지 않고 백그라운드로 돌린다.
  // 실패해도 저장된 목록이 그대로 쓰이므로 오프라인에서도 회의 시작에 지장이 없다.
  void (async (): Promise<void> => {
    if (loadSlackToken(configDir, { fs, safeStorage }) === null) return
    await syncSlackMembers()
  })()
  // settings:get·settings:update·slack:selectChannel이 공유하는 렌더러 노출용 뷰. repoRootIsGitRepo는
  // 매번 실제 경로를 재검사한다(repoRoot가 바뀔 때마다 캐시를 갱신하는 대신 단순함을 택함 — fs.existsSync
  // 1회 호출은 비용이 무시할 만하다).
  const toAppSettings = (): AppSettings => ({
    repoRoot: settings.repoRoot, autoPush: settings.autoPush,
    slackChannelId: settings.slackChannelId, slackChannelName: settings.slackChannelName,
    slackPromptShown: settings.slackPromptShown, slackAutoSend: settings.slackAutoSend,
    githubRepo: settings.githubRepo, githubPromptShown: settings.githubPromptShown, githubSync: settings.githubSync,
    defaultRepoRoot: configDir,
    repoRootIsGitRepo: isGitRepo(settings.repoRoot),
  })
  const modelPath = modelFilePath(userData, settings.modelName)
  const recordingsDir = path.join(userData, 'recordings')
  const archiveDir = path.join(userData, 'audio-archive')
  // appRoot=번들 리소스(whisper-cli) 탐색 기준, settings.repoRoot=회의록 저장 git 레포 — 별개 개념.
  // dev에서는 app.getAppPath()가 프로젝트 루트를 반환하며, 사용자가 settings.json으로 바꿀 수 없다.
  const appRoot = app.isPackaged ? process.resourcesPath : app.getAppPath()

  ipcMain.handle('env:check', () =>
    checkEnv({ commandExists: systemCommandExists, modelPath, repoRoot: settings.repoRoot, appRoot, fileExists: fs.existsSync }))

  // env:check와 분리한다 — which는 즉시 끝나지만 이건 claude를 실제로 실행해 사용량을 쓴다.
  // 같은 핸들러에 넣으면 환경 재검사(모델 다운로드 후 등)마다 사용량이 나간다.
  const claudeStatus = createClaudeStatusChecker(
    () => probeClaude({ commandExists: systemCommandExists, run: runWithStdin }),
    // 조회는 앱 실행 시 1회뿐이고 [다시 확인]은 캐시를 우회한다. 이 통지가 없으면 요약 실행이
    // 알아낸 사실이 main에만 남아, 요약이 로그인 문제로 실패했는데 설정 화면은 계속
    // "사용 가능"이라고 말하게 된다.
    (status) => {
      if (!win.isDestroyed()) win.webContents.send('claude:status-changed', status)
    })
  ipcMain.handle('claude:status', (_e, force: boolean) => claudeStatus.get(force === true))

  ipcMain.handle('model:ensure', () =>
    downloadModel({
      url: modelUrl(settings.modelName), destPath: modelPath, fetchImpl: fetch,
      onProgress: (received, total) => {
        if (!win.isDestroyed()) win.webContents.send('model:progress', received, total)
      },
    }))

  ipcMain.handle('recording:flush', (_e, recordingId: string, chunk: ArrayBuffer) => {
    if (!sink.isValidRecordingId(recordingId)) throw new Error('invalid recordingId')
    return sink.appendChunk(recordingsDir, recordingId, Buffer.from(chunk))
  })
  ipcMain.handle('recording:recoverable', () => sink.listRecoverable(recordingsDir))
  ipcMain.handle('recording:read', (_e, id: string) => {
    if (!sink.isValidRecordingId(id)) throw new Error('invalid recordingId')
    return sink.readRecording(recordingsDir, id)
  })
  // 설치 가드(리뷰 Fix Critical)용 권위 상태 — recording:state가 매번 갱신하고 update:download가
  // 읽는다(기존 onRecordingState 호출은 그대로 유지).
  let isRecording = false
  ipcMain.handle('recording:state', (_e, recording: boolean) => {
    isRecording = recording
    return opts.onRecordingState(recording)
  })

  ipcMain.handle('meetings:list', async () => {
    // pull+push 재시도 겸용. autoSync=false면 원격 접촉 없이 즉시 false.
    await pushPending({ repoRoot: settings.repoRoot, git: systemGit(settings.repoRoot), autoSync: settings.autoPush })

    // GitHub 원격 회의록 pull(로그인+레포 설정 상태, 최소 간격 스로틀 통과 시). loadMeetings보다
    // 먼저 실행해야 새로 받은 파일이 이어지는 목록에 자연히 합류한다. pullRemoteMeetings 자체는
    // throw하지 않지만, 이 블록의 다른 동기 코드(토큰 로드 등)까지 포함해 통째로 try/catch로
    // 감싸 meetings:list 반환을 절대 막지 않는다(토큰 원문은 로그에 남기지 않는다).
    if (settings.githubRepo && settings.githubSync) {
      const now = Date.now()
      if (shouldPull(lastPulledAt, now)) {
        lastPulledAt = now
        try {
          const token = loadGithubToken(configDir, { fs, safeStorage })
          if (token) {
            const repo = settings.githubRepo
            const meetingsDir = path.join(settings.repoRoot, 'meetings')
            // 리뷰 Fix 5(Minor): mkdirSync는 파일당 1회가 아니라 루프 진입 전 1회만 호출하면
            // 충분하다(디렉터리 자체는 최초 1회 생성 이후 그대로 유지된다).
            fs.mkdirSync(meetingsDir, { recursive: true })
            await pullRemoteMeetings({
              listRemote: () => listRemoteMeetings(token, repo, fetch),
              download: (filename) => downloadRemoteMeeting(token, repo, filename, fetch),
              localExists: (filename) => fs.existsSync(path.join(meetingsDir, filename)),
              // 원격 삭제가 아직 밀려 있는 회의록(#17) — 여기서 걸러내지 않으면 사용자가 지운
              // 회의록이 다음 pull에 그대로 다시 내려온다.
              isDeleted: (filename) => settings.pendingDeletes.includes(filename),
              // 리뷰 Fix 1(Critical) — 무유실 원자 보장: 'wx'(배타적 생성)로 localExists 확인과
              // 실제 쓰기 사이의 레이스를 없앤다. 그 사이 다른 경로(예: git pull, 사용자 직접 저장)로
              // 동일 파일명이 먼저 생겼다면 EEXIST가 던져지고, pullRemoteMeetings가 이를
              // "로컬 우선 스킵"으로 흡수한다(sync.ts의 writeLocal 계약 주석 참조).
              writeLocal: (filename, content) => {
                fs.writeFileSync(path.join(meetingsDir, filename), content, { flag: 'wx' })
              },
              log: console.error,
            })
          }
        } catch (e) {
          console.error('[github] 원격 회의록 동기화 실패:', e instanceof Error ? e.message : e)
        }
      }
    }

    const meetings = await loadMeetings(settings.repoRoot)

    // GitHub 미업로드 재시도 큐 처리(로그인+레포 설정 상태일 때만). 실패해도 목록 조회 자체는
    // 절대 막지 않는다 — retryPendingUploadsAndSave 내부에서 개별 실패를 흡수한다.
    // lost-update 레이스 수정(리뷰 Fix 1): getCurrentPending/savePending을 통해 저장 직전
    // 최신 settings.pendingUploads에서 "성공분만" 제거한다 — 재시도 도중(각 업로드 사이)
    // pipeline:run 실패로 큐에 추가된 항목이 있어도 절대 유실되지 않는다.
    if (settings.githubRepo && settings.githubSync && settings.pendingUploads.length > 0) {
      const token = loadGithubToken(configDir, { fs, safeStorage })
      if (token) {
        const repo = settings.githubRepo
        await retryPendingUploadsAndSave({
          pending: settings.pendingUploads,
          token,
          repo,
          readContent: (filename) => {
            // 검증 실패 항목은 디스크 접근 없이 즉시 큐에서 제거한다(리뷰 Fix 5).
            if (!isValidMeetingFilename(filename)) return null
            const p = path.join(settings.repoRoot, 'meetings', filename)
            return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null
          },
          upload: uploadMeeting,
          fetchImpl: fetch,
          log: console.error,
          getCurrentPending: () => settings.pendingUploads,
          savePending: (updated) => {
            settings = { ...settings, pendingUploads: updated }
            saveSettings(configDir, settings)
          },
        })
      }
    }

    // 원격 삭제 재시도 큐(#17) — 업로드 큐와 같은 규칙으로 성공분만 제거한다. 큐가 빌 때까지
    // 해당 파일명은 위 pull 단계에서도 제외되므로 재시도가 늦어져도 회의록이 되살아나지 않는다.
    if (settings.githubRepo && settings.githubSync && settings.pendingDeletes.length > 0) {
      const token = loadGithubToken(configDir, { fs, safeStorage })
      if (token) {
        await retryPendingDeletesAndSave({
          pending: settings.pendingDeletes,
          token,
          repo: settings.githubRepo,
          deleteRemote: deleteRemoteMeeting,
          fetchImpl: fetch,
          log: console.error,
          getCurrentPending: () => settings.pendingDeletes,
          savePending: (updated) => {
            settings = { ...settings, pendingDeletes: updated }
            saveSettings(configDir, settings)
          },
        })
      }
    }

    return meetings
  })

  ipcMain.handle('pipeline:run', async (_e, meta: MeetingMeta & { recordingId: string }, wav: ArrayBuffer) => {
    if (!sink.isValidRecordingId(meta.recordingId)) throw new Error('invalid recordingId')
    if (runningPipelines.has(meta.recordingId)) throw new Error('pipeline already running for this recording')

    runningPipelines.add(meta.recordingId)
    const wavPath = path.join(os.tmpdir(), `${meta.recordingId}.wav`)
    try {
      fs.writeFileSync(wavPath, Buffer.from(wav))
      const run = async (cmd: string, args: string[]) => {
        const { stdout } = await execFileP(cmd, args, { maxBuffer: 64 * 1024 * 1024 })
        return { stdout }
      }
      // null(번들·PATH 둘 다 없음)이면 기존과 동일하게 'whisper-cli'를 그대로 실행 시도해 ENOENT로 드러나게 둔다.
      const whisperPath =
        (await resolveWhisperCli({ appRoot, fileExists: fs.existsSync, commandExists: systemCommandExists })) ??
        'whisper-cli'
      // Slack 발송은 pipeline.ts 계약 밖의 후처리 — save에 넘어온 meeting을 저장해 두었다가
      // 저장 성공(filename 반환) 후에만 사용한다. regenerate 경로(summary:regenerate)는 이 클로저와
      // 별개로 자체 핸들러에서 notifySlackForMeeting을 호출해 발송한다(v0.4.2 — 요약이 새로 생기는
      // 흐름 커버, 재생성 시 재발송은 의도된 동작). (객체 프로퍼티로 감싼 이유: let 변수를 콜백 안에서
      // 재할당하면 TS의 흐름 분석이 초기값 null로 과협소화해 이후 narrowing이 깨진다.)
      const captured: { meeting: Omit<Meeting, 'filename'> | null; transcriptFlagged: boolean } = {
        meeting: null, transcriptFlagged: false,
      }
      // 기록자 주입(v0.4.0 ③b) — 로그인 상태(cachedGithubLogin 있음)일 때만 채운다. 여기서
      // fetchViewer를 새로 호출하지 않고 캐시만 읽는다(위 워밍업·github:loginState·로그인 성공
      // 이벤트가 갱신한 값).
      const metaWithRecorder = cachedGithubLogin ? { ...meta, recorder: cachedGithubLogin } : meta
      const result = await runPipeline(meta.recordingId, metaWithRecorder, {
        transcribe: async () => {
          const { segments, flagged } = await transcribeAndRepair({
            run, whisperPath, modelPath, wavPath, workDir: os.tmpdir(),
            readFile: (p) => fs.readFileSync(p, 'utf-8'),
          })
          captured.transcriptFlagged = flagged
          return segments
        },
        summarize: async (segments) => {
          try {
            const result = await summarize({
              run: runWithStdin, title: meta.title, segments,
              participants: meta.participants ?? [], typeDef: meetingTypeDef(meta.meetingType),
            })
            // 방금 요약이 됐다는 건 claude가 사용 가능하다는 뜻이다 — 프로브를 다시 돌릴 이유가 없다.
            claudeStatus.record({ kind: 'available' })
            return result
          } catch (e) {
            // 최초 요약도 같은 분류기를 통과시킨다. 이 경로가 실패 빈도가 가장 높은데, 그냥 던지면
            // pipeline이 message(e)만 담고 그건 'claude 실행 실패 (…)' 한 줄이라 원인이 어디에도
            // 남지 않는다(로깅은 분류기 안에만 있다). 분류된 detail로 바꿔 던져 진단을 보존한다.
            const failure = classifyClaudeFailure(e, '요약')
            claudeStatus.record(availabilityEvidence(failure))
            throw new Error(failure.detail, { cause: e })
          }
        },
        save: (meeting) => {
          const withFlag = captured.transcriptFlagged ? { ...meeting, transcriptFlagged: true } : meeting
          captured.meeting = withFlag
          return saveMeeting({
            repoRoot: settings.repoRoot, meeting: withFlag, startedAt: new Date(meta.date), git: systemGit(settings.repoRoot),
            autoSync: settings.autoPush,
          })
        },
        onStatus: (s) => {
          if (!win.isDestroyed()) win.webContents.send('pipeline:status', s)
        },
        cleanupAudio: () => archiveRecording(recordingsDir, archiveDir, meta.recordingId),
      })

      if ('filename' in result && captured.meeting) {
        const meeting: Meeting = { ...captured.meeting, filename: result.filename }
        // 실패 격리: Slack 발송은 파이프라인 결과에 영향을 주지 않는다(회의록 무영향). 실패해도
        // throw하지 않고 렌더러에 알림만 보낸다. sendSlackNotification 자체가 payload 생성 동기
        // 예외·발송 비동기 실패를 모두 흡수하므로 여기서 별도 try/catch가 필요 없다. 봇 토큰은
        // 암호화 저장소에서만 로드한다(settings.json에는 채널 ID/이름만 남는다).
        // summary:regenerate 성공 후에도 동일 경로(notifySlackForMeeting)를 탄다.
        notifySlackForMeeting(
          meeting,
          resolveSlackChannelId(meta.slackChannelId, defaultSlackChannelId(settings)),
          () => loadSlackToken(configDir, { fs, safeStorage }),
          sendSlackFailureNotice,
          undefined,
          readSlackMembers()
        )

        // GitHub 업로드(로그인+레포 설정+자동 동기화 켜짐일 때만, 단방향 업로드) — syncMeeting도
        // 동일하게 절대 throw하지 않으며, 실패 시 onFailure로 pendingUploads에 쌓아 meetings:list에서
        // 재시도한다.
        if (settings.githubRepo && settings.githubSync) {
          const token = loadGithubToken(configDir, { fs, safeStorage })
          if (token) {
            const repo = settings.githubRepo
            syncMeeting({
              filename: result.filename,
              content: serializeMeeting(meeting),
              token,
              repo,
              upload: uploadMeeting,
              fetchImpl: fetch,
              onFailure: (filename) => {
                if (!settings.pendingUploads.includes(filename)) {
                  settings = { ...settings, pendingUploads: [...settings.pendingUploads, filename] }
                  saveSettings(configDir, settings)
                }
              },
              log: console.error,
            })
          }
        }
      }

      return result
    } finally {
      fs.rmSync(wavPath, { force: true })
      runningPipelines.delete(meta.recordingId)
    }
  })

  ipcMain.handle('roster:get', () => loadRoster(configDir, fs.existsSync, (p) => fs.readFileSync(p, 'utf-8')))

  ipcMain.handle('roster:add', (_e, names: unknown) => {
    if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) {
      throw new Error('invalid names')
    }
    const current = loadRoster(configDir, fs.existsSync, (p) => fs.readFileSync(p, 'utf-8'))
    return addParticipants(current, names, (p, content) => fs.writeFileSync(p, content), configDir)
  })

  const readRoster = (): Roster =>
    loadRoster(configDir, fs.existsSync, (p) => fs.readFileSync(p, 'utf-8')) ?? { participants: [] }
  const writeRoster = (r: Roster): void =>
    saveRoster(configDir, r, (p, content) => fs.writeFileSync(p, content))

  ipcMain.handle('roster:rename', (_e, arg: unknown) => {
    if (typeof arg !== 'object' || arg === null) throw new Error('invalid')
    const { from, to } = arg as { from?: unknown; to?: unknown }
    if (typeof from !== 'string' || typeof to !== 'string') throw new Error('invalid')
    const next = renameParticipant(readRoster(), from, to)
    writeRoster(next)
    return next
  })

  ipcMain.handle('roster:remove', (_e, name: unknown) => {
    if (typeof name !== 'string') throw new Error('invalid')
    const next = removeParticipant(readRoster(), name)
    writeRoster(next)
    return next
  })

  ipcMain.handle('roster:merge', (_e, names: unknown) => {
    if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) throw new Error('invalid')
    const result = mergeNames(readRoster(), names)
    if (result.addedCount > 0) writeRoster(result.roster)
    return result
  })

  ipcMain.handle('roster:replace', (_e, names: unknown) => {
    if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) throw new Error('invalid')
    const next: Roster = { participants: dedupeAndSort(names) }
    writeRoster(next)
    return next
  })

  ipcMain.handle('roster:exportFile', async () => {
    const current = readRoster()
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'participants.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return { saved: false }
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2))
    return { saved: true }
  })

  ipcMain.handle('roster:importFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || filePaths.length === 0) return { names: null }
    const raw = fs.readFileSync(filePaths[0], 'utf-8')
    return { names: parseImportInput(raw) }
  })

  // 회의록 삭제(#17) — 파괴적 동작이라 확인 다이얼로그를 여기서 띄우고(취소면 아무것도 하지
  // 않는다), 로컬은 휴지통으로 보낸 뒤 git·원격까지 같은 호출 안에서 정리한다.
  ipcMain.handle('meetings:delete', async (_e, filename: string) => {
    if (!isValidMeetingFilename(filename)) throw new Error('invalid filename')

    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['삭제', '취소'],
      defaultId: 1,
      cancelId: 1,
      message: '이 회의록을 삭제할까요?',
      detail: '파일은 휴지통으로 이동합니다. GitHub에 동기화된 회의록이면 원격에서도 삭제됩니다.',
    })
    // canceled를 따로 알려준다 — 렌더러는 취소일 때만 목록 새로고침을 건너뛴다(디스크에서 이미
    // 사라진 파일을 지운 경우에는 deleted=false여도 목록을 다시 읽어야 한다).
    if (response !== 0) return { deleted: false, canceled: true }

    const result = await deleteMeeting({
      repoRoot: settings.repoRoot, filename,
      git: systemGit(settings.repoRoot), autoSync: settings.autoPush,
      trash: (absolutePath) => shell.trashItem(absolutePath),
    })

    // 미업로드 큐에 남아 있으면 지운 회의록을 뒤늦게 다시 올리는 셈이 된다 — 함께 제거한다.
    if (settings.pendingUploads.includes(filename)) {
      settings = { ...settings, pendingUploads: settings.pendingUploads.filter((f) => f !== filename) }
      saveSettings(configDir, settings)
    }

    if (settings.githubRepo && settings.githubSync) {
      const enqueueDelete = (): void => {
        if (settings.pendingDeletes.includes(filename)) return
        settings = { ...settings, pendingDeletes: [...settings.pendingDeletes, filename] }
        saveSettings(configDir, settings)
      }
      const token = loadGithubToken(configDir, { fs, safeStorage })
      // 토큰이 없으면(로그아웃 상태) 지금은 지울 수 없다 — 큐에 넣어두면 다음 로그인 후
      // meetings:list에서 정리되고, 그 전까지는 pull 후보에서 제외돼 부활하지 않는다.
      if (!token) enqueueDelete()
      else {
        try {
          await deleteRemoteMeeting(token, settings.githubRepo, filename, fetch)
        } catch (e) {
          console.error('[github] 원격 회의록 삭제 실패:', e instanceof Error ? e.message : e)
          enqueueDelete()
        }
      }
    }

    return { deleted: result.deleted, canceled: false }
  })

  ipcMain.handle('summary:regenerate', async (_e, filename: string): Promise<RegenerateResult> => {
    if (!isValidMeetingFilename(filename)) throw new Error('invalid filename')
    const result = await regenerateSummary({
      repoRoot: settings.repoRoot, filename,
      summarize: (meeting) =>
        summarize({
          run: runWithStdin, title: meeting.title, segments: meeting.segments,
          participants: meeting.participants, typeDef: meetingTypeDef(meeting.meetingType),
        }),
      git: systemGit(settings.repoRoot),
      autoSync: settings.autoPush,
    })
    // 재생성은 claude를 실제로 돌린 결과라 프로브보다 확실한 증거다(성공·실패 양쪽 모두).
    claudeStatus.record(result.ok ? { kind: 'available' } : availabilityEvidence(result.failure))
    if (!result.ok) return result
    // pipeline:run과 동일한 후처리 경로 — 요약이 갱신된 뒤에만 Slack 발송을 시도한다(실패 격리 동일).
    notifySlackForMeeting(
      result.meeting,
      defaultSlackChannelId(settings),
      () => loadSlackToken(configDir, { fs, safeStorage }),
      sendSlackFailureNotice,
      undefined,
      readSlackMembers()
    )
    return result
  })

  ipcMain.handle('settings:get', (): AppSettings => toAppSettings())

  ipcMain.handle('settings:update', (_e, patch: {
    repoRoot?: string; autoPush?: boolean
    slackPromptShown?: boolean; slackAutoSend?: boolean
    githubRepo?: string | null; githubPromptShown?: boolean; githubSync?: boolean
  }): AppSettings => {
    if (patch.repoRoot !== undefined) {
      // renderer는 신뢰 경계 밖 — 타입 선언과 무관하게 런타임에 검증한다.
      if (typeof patch.repoRoot !== 'string' || !fs.existsSync(patch.repoRoot) || !fs.statSync(patch.repoRoot).isDirectory()) {
        throw new Error('invalid repoRoot')
      }
    }
    if ('autoPush' in patch && typeof patch.autoPush !== 'boolean') {
      throw new Error('invalid autoPush')
    }
    if ('slackPromptShown' in patch && typeof patch.slackPromptShown !== 'boolean') {
      throw new Error('invalid slackPromptShown')
    }
    if ('slackAutoSend' in patch && typeof patch.slackAutoSend !== 'boolean') {
      throw new Error('invalid slackAutoSend')
    }
    if ('githubRepo' in patch) {
      const v = patch.githubRepo
      if (v !== null && (typeof v !== 'string' || !GITHUB_REPO_RE.test(v))) {
        throw new Error('invalid githubRepo')
      }
    }
    if ('githubPromptShown' in patch && typeof patch.githubPromptShown !== 'boolean') {
      throw new Error('invalid githubPromptShown')
    }
    if ('githubSync' in patch && typeof patch.githubSync !== 'boolean') {
      throw new Error('invalid githubSync')
    }
    // pendingUploads·pendingDeletes는 내부 관리 필드(github/sync.ts·meetings:delete만 갱신) —
    // renderer가 patch로 바꿀 수 없다.
    if ('pendingUploads' in patch) {
      throw new Error('pendingUploads는 변경할 수 없는 필드입니다')
    }
    if ('pendingDeletes' in patch) {
      throw new Error('pendingDeletes는 변경할 수 없는 필드입니다')
    }
    // 리뷰 Fix 2 — githubRepo가 실제로 바뀌면(동일 값 재설정은 제외) 스로틀을 리셋한다: 이전
    // 레포 기준으로 쌓인 lastPulledAt은 새 레포에 대해 의미가 없다.
    if ('githubRepo' in patch && patch.githubRepo !== settings.githubRepo) {
      resetPullThrottle()
    }
    // v0.4.0 ④ — 레포를 처음 선택하는 시점(null → 값)에 자동 동기화를 자동으로 켠다. 호출부가
    // 이미 명시적으로 githubSync를 함께 보냈다면(예: 향후 확장) 그 값을 존중한다.
    const autoGithubSync =
      'githubRepo' in patch && settings.githubRepo === null && patch.githubRepo !== null && !('githubSync' in patch)
        ? { githubSync: true as const }
        : {}
    // 리뷰 Fix 1 — 마이그레이션 재시도: safeStorage가 그동안(기동 시 미가용 → 이후 가용) 가용해졌다면
    // 디스크에 남아 있는 레거시 평문 slackBotToken을 여기서 다시 이관 시도한다. saveSettings 자체가
    // 미이관 필드를 보존하도록 바뀌었지만(위), 그 상태로 방치하기보다 매 설정 변경 시점마다
    // 즉시 재시도해 가능한 한 빨리 평문을 제거한다.
    migrateLegacySlackToken(configDir, {
      tokenStoreFs: fs,
      safeStorage,
      readSettingsFile: readSlackSettingsFile,
      writeSettingsFile: writeSlackSettingsFile
    })
    settings = { ...settings, ...patch, ...autoGithubSync }
    saveSettings(configDir, settings)
    return toAppSettings()
  })

  ipcMain.handle('dialog:pickFolder', async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  ipcMain.handle('app:version', () => app.getVersion())

  // ── 자동 업데이트(v0.4.0 ③b) ────────────────────────────────────────────
  // GitHub Releases(public 전환 예정)를 인증 없는 업데이트 피드로 쓴다. 오너 확정 UX: 팝업 알림 →
  // [업데이트] 클릭 → 적용(자동 다운로드·자동 설치는 하지 않는다 — createUpdater가 강제).
  const updater = createUpdater({
    autoUpdater: autoUpdater as unknown as AutoUpdaterLike,
    isPackaged: () => app.isPackaged,
    onBeforeInstall: opts.onBeforeInstall
  })

  // 스케줄·보관·실패 집계는 electron 비의존 notifier가 담당한다(단위 테스트 대상). 여기 남는 것은
  // 타이머·창 이벤트·IPC 배선뿐이다. update:available 이벤트만 쏘면 렌더러가 아직 구독하기 전에
  // 도착한 알림이 유실되므로(기동 확인이 STARTUP_CHECK_DELAY_MS 뒤라 실제로 앞설 수 있다)
  // notifier가 마지막 결과를 보관하고 update:latest로 다시 꺼내갈 수 있게 한다.
  const notifier = createUpdateNotifier({
    check: () => updater.checkForUpdates(),
    notify: (result) => {
      if (!win.isDestroyed()) win.webContents.send('update:available', result)
      // 창이 파괴됐는데 조용히 넘기면 알림이 영구히 멈춘 것을 아무도 모른다.
      else console.error('[updater] 창이 파괴돼 새 버전 알림을 전달하지 못했다:', result.version)
    },
    now: () => Date.now()
  })

  // 저장소 비공개 상태 업데이트 안내(v0.4.1) — 레포가 public으로 전환되기 전에는 업데이트
  // 피드(GitHub Releases) 조회가 404/HttpError 등으로 실패한다. 이를 classifyUpdateError로
  // 분류해 feed_unreachable이면 오류가 아닌 { available:false, error:'feed_unreachable' }로
  // 정규화해 반환한다 — 렌더러가 catch가 아닌 안내 분기로 단순 처리할 수 있다. 그 외 오류는
  // 기존대로 reject해 기존 오류 표시 흐름을 유지한다.
  ipcMain.handle('update:check', async (): Promise<UpdateCheckResult> => {
    try {
      const result = await updater.checkForUpdates()
      // 수동 확인도 같은 보관소·스탬프를 갱신한다 — 설정에서 발견한 새 버전을 배너도 되찾을 수 있다.
      notifier.recordManualCheck(result)
      return result
    } catch (e) {
      if (classifyUpdateError(e) === 'feed_unreachable') return { available: false, error: 'feed_unreachable' }
      throw e
    }
  })

  ipcMain.handle('update:download', () => {
    // 설치 가드(리뷰 Fix Critical) — 다운로드 완료 즉시 quitAndInstall이 앱을 강제 재시작하므로,
    // 녹음 중이거나 전사·요약 파이프라인이 실행 중이면 시작 전에 차단한다(진행 중 작업 유실 방지).
    const guard = canInstallUpdate({ isRecording, runningPipelineCount: runningPipelines.size })
    if (!guard.ok) throw new Error(guard.reason)

    return updater.downloadAndInstall((progress) => {
      if (!win.isDestroyed()) win.webContents.send('update:progress', progress)
    })
  })

  ipcMain.handle('update:latest', (): UpdateCheckResult | null => notifier.latest())
  ipcMain.handle('update:autoCheckStatus', (): AutoCheckStatus => notifier.status())

  // 실패는 notifier가 분류·집계·로깅하고 기동을 막지 않는다.
  setTimeout(() => void notifier.maybeCheck('startup'), STARTUP_CHECK_DELAY_MS)
  // 짧게 틱을 돌리고 실제 확인 간격은 notifier가 정한다 — 절전 복귀로 밀린 주기를 빨리 만회하고,
  // 실패 뒤 재시도도 4시간을 기다리지 않는다. 인터벌은 프로세스 수명과 같다(창을 닫아도 트레이에
  // 상주하므로 'closed'는 실제 종료 시에만 발화한다 — 그 시점의 정리는 의미가 없다).
  setInterval(() => void notifier.maybeCheck('periodic'), CHECK_TICK_MS)
  // 트레이 상주 앱이라 창을 닫아도 프로세스는 살아 있다 — 다시 여는 순간이 사용자가 앱을
  // 의식하는 시점이라 알림을 보기 가장 자연스럽다.
  win.on('show', () => void notifier.maybeCheck('window-show'))

  // ── GitHub OAuth(Device Flow) + 동기화(v0.3.0 ③) ──────────────────────────
  // 세션 경합·취소(리뷰 Fix 3) — 실제 fetch/safeStorage/BrowserWindow는 여기서 주입하고,
  // 세션 무효화 판단·폴링 조기 종료·이벤트 억제 로직은 electron 비의존 순수 모듈이 담당한다.
  ipcMain.handle('github:startLogin', () =>
    loginSessionManager.startLogin({
      requestDeviceCode: () => requestDeviceCode(fetch),
      pollForToken: (deviceCode, interval, isCancelled) =>
        pollForToken(deviceCode, interval, fetch, {
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          isCancelled,
        }),
      saveToken: (accessToken) => saveGithubToken(configDir, accessToken, { fs, safeStorage }),
      fetchViewer: (accessToken) => fetchViewer(accessToken, fetch),
      // 창이 그 사이 닫혀도(isDestroyed) send를 건너뛸 뿐 세션 로직 자체는 영향받지 않는다.
      sendEvent: (event) => {
        // 리뷰 Fix 2 — 로그인 성공 시 스로틀 리셋: 로그아웃→재로그인 사이 계정/권한이 바뀌었을
        // 수 있으므로, 다음 meetings:list에서 곧바로 pull이 실행되도록 한다.
        if (event.status === 'success') {
          resetPullThrottle()
          cachedGithubLogin = event.login // 기록자(recorder) 캐시 갱신 — 추가 네트워크 호출 없음
        }
        if (!win.isDestroyed()) win.webContents.send('github:login-status', event)
      },
    })
  )

  ipcMain.handle('github:cancelLogin', () => {
    loginSessionManager.cancel()
  })

  ipcMain.handle('github:loginState', async (): Promise<GithubLoginState> => {
    const token = loadGithubToken(configDir, { fs, safeStorage })
    if (!token) {
      cachedGithubLogin = undefined
      return { loggedIn: false, repo: settings.githubRepo }
    }
    try {
      const viewer = await fetchViewer(token, fetch)
      cachedGithubLogin = viewer.login // 기록자(recorder) 캐시 갱신 — 이 호출은 어차피 필요했던 조회다
      return { loggedIn: true, login: viewer.login, repo: settings.githubRepo }
    } catch {
      cachedGithubLogin = undefined
      return { loggedIn: false, repo: settings.githubRepo }
    }
  })

  ipcMain.handle('github:logout', () => {
    deleteGithubToken(configDir, { fs })
    // 로그아웃 시 이전에 선택한 레포 설정도 함께 초기화한다(리뷰 Fix 5) — 토큰 없이 레포만
    // 남아 있으면 재로그인 시 의도치 않은 저장소로 업로드될 수 있다.
    settings = { ...settings, githubRepo: null }
    saveSettings(configDir, settings)
    // 리뷰 Fix 2 — 로그아웃 시 스로틀도 리셋: 재로그인 후 곧바로 pull이 실행되도록 한다.
    resetPullThrottle()
    cachedGithubLogin = undefined // 기록자(recorder) 캐시도 함께 비운다
  })

  ipcMain.handle('github:listRepos', async (): Promise<string[]> => {
    const token = loadGithubToken(configDir, { fs, safeStorage })
    if (!token) throw new Error('GitHub에 로그인되어 있지 않습니다')
    return listGithubRepos(token, fetch)
  })

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    // 임의 프로토콜 실행(file://, 커스텀 스킴 등)을 막기 위해 https만 허용한다.
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('invalid url')
    return shell.openExternal(url)
  })

  // ── Slack 봇 토큰(암호화 저장) + 채널 선택(v0.4.0 ②) ──────────────────────
  // 토큰 원문은 어떤 IPC 응답으로도 렌더러에 돌아가지 않는다(saved 여부만 노출).
  ipcMain.handle('slack:tokenState', (): SlackTokenState => ({
    saved: loadSlackToken(configDir, { fs, safeStorage }) !== null,
  }))

  ipcMain.handle('slack:saveToken', (_e, token: string): SlackTokenState => {
    if (typeof token !== 'string' || !token.startsWith('xoxb-')) {
      throw new Error('invalid slack token')
    }
    saveSlackToken(configDir, token, { fs, safeStorage })
    // 연결 직후 1회 동기화 — 결과를 기다리지 않는다(설정 화면이 slack:membersState로 따로 읽는다).
    void syncSlackMembers()
    return { saved: true }
  })

  ipcMain.handle('slack:clearToken', (): void => {
    deleteSlackToken(configDir, { fs })
    // 멤버 목록은 워크스페이스 종속 데이터라 토큰과 생애주기를 맞춘다.
    deleteSlackMembers(configDir, (p) => fs.rmSync(p, { force: true }))
    // github:logout과 동일한 원칙(리뷰 Fix 5) — 토큰 없이 채널 선택만 남으면 다음에 새 토큰을
    // 등록했을 때 검증되지 않은 채널로 발송될 수 있다.
    settings = { ...settings, slackChannelId: null, slackChannelName: null, slackAutoSend: false }
    saveSettings(configDir, settings)
  })

  ipcMain.handle('slack:listChannels', async (): Promise<SlackChannel[]> => {
    const token = loadSlackToken(configDir, { fs, safeStorage })
    if (!token) throw new Error('Slack 봇 토큰이 등록되어 있지 않습니다')
    return listChannels(token, fetch)
  })

  ipcMain.handle(
    'slack:selectChannel',
    async (_e, channelId: string, channelName: string): Promise<AppSettings> => {
      if (typeof channelId !== 'string' || channelId.trim() === '') throw new Error('invalid channelId')
      if (typeof channelName !== 'string' || channelName.trim() === '') throw new Error('invalid channelName')

      // v0.4.4 — 자동 참여(conversations.join) 제거. 목록 자체가 봇이 실제 참여 중인 채널만
      // 보여주므로(listChannels 참고) 선택 시 join 시도가 애초에 불필요하다. channelId/name 저장만 한다.
      // 채널을 처음 선택하는 시점(null → 값)에는 자동 발송을 자동으로 켠다 — githubRepo 첫
      // 선택 시 githubSync를 켜는 관례와 동일. 이후 채널만 바꾸는 경우에는 사용자가 정한
      // slackAutoSend 값을 건드리지 않는다.
      const firstSelection = settings.slackChannelId === null
      settings = {
        ...settings,
        slackChannelId: channelId,
        slackChannelName: channelName,
        slackAutoSend: firstSelection ? true : settings.slackAutoSend
      }
      saveSettings(configDir, settings)

      return toAppSettings()
    }
  )

  // 기본 알림 채널 해제 — 채널이 없으면 자동 발송도 의미가 없으므로 함께 내린다.
  ipcMain.handle('slack:clearChannel', (): AppSettings => {
    settings = { ...settings, slackChannelId: null, slackChannelName: null, slackAutoSend: false }
    saveSettings(configDir, settings)
    return toAppSettings()
  })

  // 저장된 멤버 목록 조회 — 회의 시작 모달과 설정 화면이 쓴다. 여기서는 동기화하지 않는다
  // (모달이 즉시 떠야 하고, 참석자를 고르는 도중 목록이 흔들리면 안 된다).
  ipcMain.handle('slack:membersState', (): SlackMembersState => ({
    ...loadSlackMembers(configDir, fs.existsSync, (p) => fs.readFileSync(p, 'utf-8')),
    error: null
  }))

  ipcMain.handle('slack:syncMembers', syncSlackMembers)

  // ── 회의록 공유(수동) ──────────────────────────────────────────────────
  // 저장 직후 자동 발송(notifySlackForMeeting)과 달리 사용자가 직접 누른 액션이므로 실패를
  // 삼키지 않는다 — 예외를 그대로 렌더러로 올려 공유 모달이 사유를 표시한다.
  const readMeetingFile = (filename: string): string => {
    if (!isValidMeetingFilename(filename)) throw new Error('invalid filename')
    return fs.readFileSync(path.join(settings.repoRoot, 'meetings', filename), 'utf-8')
  }

  ipcMain.handle('clipboard:write', (_e, text: string): void => {
    if (typeof text !== 'string') throw new Error('invalid text')
    clipboard.writeText(text)
  })

  ipcMain.handle(
    'share:exportFile',
    async (_e, filename: string, format: ExportFormat): Promise<{ saved: boolean; path?: string }> => {
      if (format !== 'md' && format !== 'txt') throw new Error('invalid format')
      const raw = readMeetingFile(filename)
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: exportFileName(filename, format),
        filters: [{ name: format === 'md' ? 'Markdown' : 'Text', extensions: [format] }],
      })
      if (canceled || !filePath) return { saved: false }
      fs.writeFileSync(filePath, exportContent(filename, raw, format))
      return { saved: true, path: filePath }
    }
  )

  ipcMain.handle('share:sendSlack', async (_e, filename: string, channelId: string): Promise<void> => {
    if (typeof channelId !== 'string' || channelId.trim() === '') throw new Error('invalid channelId')
    const token = loadSlackToken(configDir, { fs, safeStorage })
    if (!token) throw new Error('Slack 봇 토큰이 등록되어 있지 않습니다')
    const meeting = parseMeeting(filename, readMeetingFile(filename))
    await postChatMessage(token, buildPostMessageBody(meeting, channelId), fetch)
  })
}
