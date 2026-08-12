import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppSettings,
  AutoCheckStatus,
  ClaudeAccount,
  ClaudeInstallDone,
  ClaudeLoginEvent,
  ClaudeStatus,
  GithubLoginState,
  GithubLoginStatusEvent,
  RegenerateResult,
  SlackChannel,
  SlackMembersState,
  SlackSendFailure,
  SlackSendScope,
  SlackTokenState,
  UpdateCheckResult,
  UpdateProgress
} from '../shared/types'
import type { ExportFormat } from '../shared/share-format'

// Custom APIs for renderer (template demo — kept until Tasks 12-14 replace the renderer)
const api = {}

const minutingApi = {
  // 렌더러에는 process가 없다(nodeIntegration 꺼짐). 설치 명령이 플랫폼마다 달라 이 값이 필요하다.
  platform: process.platform,
  checkEnv: () => ipcRenderer.invoke('env:check'),
  // 계약(캐시·force·사용량)은 main의 ClaudeStatusChecker.get이 원본이다.
  checkClaudeStatus: (force = false): Promise<ClaudeStatus> =>
    ipcRenderer.invoke('claude:status', force),
  // 실제 요약 실행이 알아낸 판정. 조회는 앱 실행 시 1회뿐이라 이 통지가 없으면 세션 중에
  // 상태가 바뀌어도 화면이 따라오지 못한다.
  // 반환 타입을 () => void로 못박는다 — removeListener는 IpcRenderer를 반환해서, 그대로
  // 흘리면 useEffect의 cleanup 자리에 쓸 수 없다.
  onClaudeStatus: (cb: (s: ClaudeStatus) => void): (() => void) => {
    const listener = (_: unknown, s: ClaudeStatus): void => cb(s)
    ipcRenderer.on('claude:status-changed', listener)
    return () => {
      ipcRenderer.removeListener('claude:status-changed', listener)
    }
  },
  // 인앱 Claude 로그인 — 브라우저 OAuth 동의를 거치므로 결과는 invoke 반환값이 아니라
  // claude:login-status 이벤트로 온다.
  startClaudeLogin: (): Promise<void> => ipcRenderer.invoke('claude:startLogin'),
  // 어느 계정으로 로그인했는지 — 로그인 여부만으로는 회사·개인 계정을 구분할 수 없다.
  getClaudeAccount: (): Promise<ClaudeAccount | null> => ipcRenderer.invoke('claude:account'),
  cancelClaudeLogin: (): Promise<void> => ipcRenderer.invoke('claude:cancelLogin'),
  onClaudeLoginStatus: (cb: (e: ClaudeLoginEvent) => void): (() => void) => {
    const listener = (_: unknown, e: ClaudeLoginEvent): void => cb(e)
    ipcRenderer.on('claude:login-status', listener)
    return () => {
      ipcRenderer.removeListener('claude:login-status', listener)
    }
  },
  // 인앱 Claude CLI 설치 — 출력이 계속 나오므로 진행은 이벤트로 받는다.
  startClaudeInstall: (): Promise<void> => ipcRenderer.invoke('claude:install'),
  cancelClaudeInstall: (): Promise<void> => ipcRenderer.invoke('claude:cancelInstall'),
  // 화면은 끝부분만 유지하므로, 전문을 볼 수 있는 경로를 알려줘야 한다.
  getClaudeInstallLogPath: (): Promise<string> => ipcRenderer.invoke('claude:installLogPath'),
  onClaudeInstallOutput: (cb: (chunk: string) => void): (() => void) => {
    const listener = (_: unknown, chunk: string): void => cb(chunk)
    ipcRenderer.on('claude:install-output', listener)
    return () => {
      ipcRenderer.removeListener('claude:install-output', listener)
    }
  },
  onClaudeInstallDone: (cb: (r: ClaudeInstallDone) => void): (() => void) => {
    const listener = (_: unknown, r: ClaudeInstallDone): void => cb(r)
    ipcRenderer.on('claude:install-done', listener)
    return () => {
      ipcRenderer.removeListener('claude:install-done', listener)
    }
  },
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
      slackPromptShown?: boolean; slackAutoSend?: boolean; slackSendScope?: SlackSendScope
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
  clearSlackChannel: (): Promise<AppSettings> => ipcRenderer.invoke('slack:clearChannel'),
  // Slack 멤버 동기화 — 회의 시작 화면의 Slack 참석자 후보. membersState는 저장된 목록만
  // 읽고(즉시 반환), syncMembers가 users.list를 호출해 갱신한다.
  getSlackMembers: (): Promise<SlackMembersState> => ipcRenderer.invoke('slack:membersState'),
  syncSlackMembers: (): Promise<SlackMembersState> => ipcRenderer.invoke('slack:syncMembers'),
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
