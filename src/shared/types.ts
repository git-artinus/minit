export interface TranscriptSegment { startMs: number; text: string }
export interface ActionItem { text: string; assignee?: string; due?: string }
// 회의 본문 섹션(v0.6.0 #3) — 공통 summary 외의 타입별 내용은 순서 있는 섹션 배열로 표현한다.
// kind가 직렬화·렌더·Slack 렌더 방식을 결정한다(타입별 분기 없음).
export type MeetingSection =
  | { heading: string; kind: 'text'; text: string }
  | { heading: string; kind: 'list'; items: string[] }
  | { heading: string; kind: 'actions'; items: ActionItem[] }
export interface MeetingMeta {
  title: string; date: string /* ISO8601 */; durationMin: number; participants: string[]
  // 기록자(v0.4.0 ③b) — GitHub 로그인 상태일 때만 채워진다(로그인 login명). 비로그인 시 생략.
  recorder?: string
  // 회의별 Slack 발송 채널 override(v0.6.0 #2) — undefined=설정 기본값 사용 /
  // null=이번 회의 발송 안 함 / string=이 채널로. 회의록 파일에는 저장하지 않는 전송 시점 전용 값.
  slackChannelId?: string | null
  // 회의 타입(v0.6.0 #3) — meeting-types 레지스트리의 id. 미지정 시 general로 취급한다.
  meetingType?: string
}
export interface Meeting extends MeetingMeta {
  filename: string
  meetingType: string  // 저장 시 항상 확정값(구파일 파싱 시 general 폴백)
  summary: string
  sections: MeetingSection[]
  segments: TranscriptSegment[]
  // 재전사 후에도 반복이 남아 일부 구간이 신뢰 불가일 수 있음(뷰어 경고 표시용).
  transcriptFlagged?: boolean
  pendingPush?: boolean  // push 실패 상태 표시용 (storage가 설정)
}
export type PipelineStage = 'transcribing' | 'summarizing' | 'saving' | 'done'
export interface PipelineStatus {
  recordingId: string; stage: PipelineStage
  error?: { stage: PipelineStage; message: string }
  filename?: string  // saving 이후 채워짐
}
export interface EnvReport {
  git: boolean; claude: boolean; whisper: boolean; model: boolean; repoRoot: string
}
// 요약 실패 사유(#8) — claude CLI는 런타임 오류를 stdout에 쓰고 exit 1로 끝나므로,
// exit code·stdout·stderr를 함께 봐야 원인을 가릴 수 있다. 분류는 main에서만 수행하고
// (renderer 정규식 매칭은 버전·언어에 취약해 폐기) 렌더러는 사유 → 문구 매핑만 한다.
export type SummaryFailureReason =
  | 'not_installed'      // claude 실행 파일 없음 (spawn ENOENT)
  | 'not_authenticated'  // 로그인 안 됨 / API 키 무효
  | 'usage_limit'        // 사용량·한도 소진
  | 'timeout'            // 제한 시간 초과로 강제 종료(SIGTERM)
  | 'invalid_output'     // exit 0인데 JSON 스키마를 벗어난 응답
  | 'unknown'            // 그 외 — detail에 원문을 그대로 실어 보낸다
export interface SummaryFailure {
  reason: SummaryFailureReason
  // 사용자에게 보여줄 원인. 프롬프트 전문은 절대 포함하지 않는다(그게 원인을 가리던 주범이다).
  detail: string
  exitCode?: number
}
/**
 * 요약 재생성 결과. 예상된 실패(claude)는 예외가 아니라 반환값으로 표현한다 —
 * ipcMain.handle이 예외를 renderer로 넘길 때 message만 남기고 커스텀 프로퍼티를 잃기 때문이다.
 * 파일 IO·git 오류는 계속 throw한다(예상 밖 예외와 섞지 않는다).
 */
export type RegenerateResult =
  | { ok: true; meeting: Meeting }
  | { ok: false; failure: SummaryFailure }
// 개인 로스터(v0.4.0 ③a) — 회사 명단(teams 구조)을 폐기하고 사용자별 ~/.minit/participants.json에
// 저장하는 평평한 이름 목록으로 재컨셉했다. 팀 구조·한글 이름 병기는 더 이상 없다.
export interface Roster { participants: string[] }
export interface AppSettings {
  repoRoot: string; autoPush: boolean
  // Slack 봇 토큰 자체는 절대 렌더러로 반환하지 않는다(slack:tokenState의 saved만 노출).
  slackChannelId: string | null; slackChannelName: string | null; slackPromptShown: boolean
  githubRepo: string | null; githubPromptShown: boolean
  // GitHub 자동 동기화(업로드·pull) 실행 여부(v0.4.0 ④) — 레포를 처음 선택하면 자동으로 켜진다.
  githubSync: boolean
  // 저장 위치 "기본값으로 재설정" 버튼용(v0.3.1 Fix 3) — main의 minitHome() 값.
  defaultRepoRoot: string
  // 저장 위치(repoRoot)가 git 레포(.git 존재)인지 — "자동 업로드(Git Push)" 스위치 노출 조건(v0.4.0 ④).
  repoRootIsGitRepo: boolean
}

export interface SlackTokenState {
  saved: boolean
}

export interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
}

// 자동 발송 실패 알림 payload — 메인이 렌더러로 보낸다(slack:send-failed).
export interface SlackSendFailure {
  title: string
  reason: string
}

export interface GithubLoginState {
  loggedIn: boolean
  login?: string
  repo: string | null
}

export type GithubLoginStatusEvent =
  | { status: 'success'; login: string }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string }

// 자동 업데이트(v0.4.0 ③b) — electron-updater 결과를 정규화한 형태(main/updater.ts 참조).
// error(v0.4.1) — 저장소가 private인 동안 업데이트 피드(GitHub Releases)에 접근할 수 없을 때
// ipc.ts가 classifyUpdateError로 분류해 실어 보낸다. 렌더러는 이를 오류가 아닌 안내로 표시한다.
export interface UpdateCheckResult {
  available: boolean
  version?: string
  error?: 'feed_unreachable'
}

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
}
