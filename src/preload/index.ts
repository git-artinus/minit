import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppSettings,
  AutoCheckStatus,
  ClaudeStatus,
  GithubLoginState,
  GithubLoginStatusEvent,
  RegenerateResult,
  SlackChannel,
  SlackSendFailure,
  SlackTokenState,
  UpdateCheckResult,
  UpdateProgress
} from '../shared/types'
import type { ExportFormat } from '../shared/share-format'

// Custom APIs for renderer (template demo — kept until Tasks 12-14 replace the renderer)
const api = {}

const minutingApi = {
  checkEnv: () => ipcRenderer.invoke('env:check'),
  // force=true는 캐시를 무시하고 claude를 다시 실행한다(사용량을 쓰므로 사용자가 [다시 확인]을
  // 누를 때만 넘긴다).
  checkClaudeStatus: (force = false): Promise<ClaudeStatus> =>
    ipcRenderer.invoke('claude:status', force),
  ensureModel: () => ipcRenderer.invoke('model:ensure'),
  onModelProgress: (cb: (r: number, t: number) => void) => {
    const listener = (_: unknown, r: number, t: number) => cb(r, t)
    ipcRenderer.on('model:progress', listener)
    return () => ipcRenderer.removeListener('model:progress', listener)
  },
  flushChunk: (id: string, chunk: ArrayBuffer) => ipcRenderer.invoke('recording:flush', id, chunk),
  findRecoverableRecordings: () => ipcRenderer.invoke('recording:recoverable'),
  readRecoverableRecording: (id: string) => ipcRenderer.invoke('recording:read', id),
  setRecordingState: (r: boolean) => ipcRenderer.invoke('recording:state', r),
  runPipeline: (meta: unknown, wav: ArrayBuffer) => ipcRenderer.invoke('pipeline:run', meta, wav),
  onPipelineStatus: (cb: (s: unknown) => void) => {
    const listener = (_: unknown, s: unknown) => cb(s)
    ipcRenderer.on('pipeline:status', listener)
    return () => ipcRenderer.removeListener('pipeline:status', listener)
  },
  listMeetings: () => ipcRenderer.invoke('meetings:list'),
  // 확인 다이얼로그는 main에서 띄운다 — 취소하면 deleted=false로 돌아온다.
  deleteMeeting: (filename: string): Promise<{ deleted: boolean; canceled: boolean }> =>
    ipcRenderer.invoke('meetings:delete', filename),
  getRoster: () => ipcRenderer.invoke('roster:get'),
  addRosterParticipants: (names: string[]) => ipcRenderer.invoke('roster:add', names),
  renameRosterParticipant: (from: string, to: string) => ipcRenderer.invoke('roster:rename', { from, to }),
  removeRosterParticipant: (name: string) => ipcRenderer.invoke('roster:remove', name),
  mergeRoster: (names: string[]) => ipcRenderer.invoke('roster:merge', names),
  replaceRoster: (names: string[]) => ipcRenderer.invoke('roster:replace', names),
  exportRosterFile: () => ipcRenderer.invoke('roster:exportFile'),
  importRosterFile: () => ipcRenderer.invoke('roster:importFile'),
  regenerateSummary: (filename: string): Promise<RegenerateResult> =>
    ipcRenderer.invoke('summary:regenerate', filename),
  // 회의록 공유 — 클립보드는 렌더러가 file:// 오리진으로 로드될 때 navigator.clipboard가 막힐 수
  // 있어 메인 프로세스를 경유한다.
  writeClipboard: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  exportMeetingFile: (filename: string, format: ExportFormat): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke('share:exportFile', filename, format),
  shareMeetingToSlack: (filename: string, channelId: string): Promise<void> =>
    ipcRenderer.invoke('share:sendSlack', filename, channelId),
  onSlackSendFailed: (cb: (f: SlackSendFailure) => void) => {
    const listener = (_: unknown, f: SlackSendFailure) => cb(f)
    ipcRenderer.on('slack:send-failed', listener)
    return () => ipcRenderer.removeListener('slack:send-failed', listener)
  },
  onTrayCommand: (cb: (cmd: string) => void) => {
    const listener = (_: unknown, cmd: string) => cb(cmd)
    ipcRenderer.on('tray:command', listener)
    return () => ipcRenderer.removeListener('tray:command', listener)
  },
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (
    patch: {
      repoRoot?: string; autoPush?: boolean
      slackPromptShown?: boolean
      githubRepo?: string | null; githubPromptShown?: boolean; githubSync?: boolean
    }
  ): Promise<AppSettings> => ipcRenderer.invoke('settings:update', patch),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  // GitHub OAuth(Device Flow) + 동기화(v0.3.0 ③)
  startGithubLogin: (): Promise<{ userCode: string; verificationUri: string }> =>
    ipcRenderer.invoke('github:startLogin'),
  onGithubLoginStatus: (cb: (e: GithubLoginStatusEvent) => void) => {
    const listener = (_: unknown, e: GithubLoginStatusEvent) => cb(e)
    ipcRenderer.on('github:login-status', listener)
    return () => ipcRenderer.removeListener('github:login-status', listener)
  },
  getGithubLoginState: (): Promise<GithubLoginState> => ipcRenderer.invoke('github:loginState'),
  cancelLogin: (): Promise<void> => ipcRenderer.invoke('github:cancelLogin'),
  githubLogout: (): Promise<void> => ipcRenderer.invoke('github:logout'),
  listGithubRepos: (): Promise<string[]> => ipcRenderer.invoke('github:listRepos'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  // Slack 봇 토큰(암호화 저장) + 채널 선택(v0.4.0 ②) — 토큰 원문은 절대 반환되지 않는다.
  getSlackTokenState: (): Promise<SlackTokenState> => ipcRenderer.invoke('slack:tokenState'),
  saveSlackToken: (token: string): Promise<SlackTokenState> => ipcRenderer.invoke('slack:saveToken', token),
  clearSlackToken: (): Promise<void> => ipcRenderer.invoke('slack:clearToken'),
  listSlackChannels: (): Promise<SlackChannel[]> => ipcRenderer.invoke('slack:listChannels'),
  selectSlackChannel: (channelId: string, channelName: string): Promise<AppSettings> =>
    ipcRenderer.invoke('slack:selectChannel', channelId, channelName),
  // 자동 업데이트(v0.4.0 ③b)
  checkForUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('update:check'),
  // 배너가 마운트될 때 이미 감지된 새 버전을 되찾는다 — 기동 확인이 렌더러 구독보다 앞서면
  // update:available 이벤트가 유실되기 때문이다.
  getLatestUpdate: (): Promise<UpdateCheckResult | null> => ipcRenderer.invoke('update:latest'),
  // 자동 확인이 계속 실패하면 사용자는 구버전에 고립된 채 아무 신호도 못 받는다 — 설정에서 알린다.
  getAutoCheckStatus: (): Promise<AutoCheckStatus> => ipcRenderer.invoke('update:autoCheckStatus'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
  onUpdateAvailable: (cb: (r: UpdateCheckResult) => void) => {
    const listener = (_: unknown, r: UpdateCheckResult) => cb(r)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  },
  onUpdateProgress: (cb: (p: UpdateProgress) => void) => {
    const listener = (_: unknown, p: UpdateProgress) => cb(p)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('minuting', minutingApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.minuting = minutingApi
}

export type MinutingApi = typeof minutingApi
