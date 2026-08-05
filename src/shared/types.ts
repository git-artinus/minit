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
// claude는 여기 없다(#8) — `which claude`가 증명하는 "설치됨"을 화면이 "쓸 수 있음"으로 읽는 것이
// 이 이슈의 원인이었다. 사용 가능 여부는 ClaudeStatus 하나만 말한다(main/claude-status.ts).
export interface EnvReport {
  git: boolean; whisper: boolean; model: boolean; repoRoot: string
}
// 요약 실패 사유(#8) — claude CLI는 런타임 오류를 stdout에 쓰고 non-zero로 끝난다. 종료 코드만으론
// 원인을 가릴 수 없어 spawn 오류 코드·종료 시그널·stdout/stderr 텍스트를 함께 본다. 분류는 main에서만
// 수행하고(renderer 정규식 매칭은 버전·언어에 취약해 폐기) 렌더러는 사유 → 문구 매핑만 한다.
export type SummaryFailureReason =
  | 'not_installed'      // claude 실행 파일 없음 (spawn ENOENT)
  | 'not_authenticated'  // 로그인 안 됨 / API 키 무효
  | 'usage_limit'        // 사용량·한도 소진
  | 'timeout'            // 제한 시간 초과로 강제 종료(SIGTERM)
  | 'invalid_output'     // exit 0인데 JSON 스키마를 벗어난 응답
  | 'unknown'            // 그 외 — detail에 원문을 그대로 실어 보낸다
export interface SummaryFailure {
  reason: SummaryFailureReason
  // 사용자에게 보여줄 원인. 프롬프트 전문을 담지 않는다(그게 원인을 가리던 주범이다) —
  // ClaudeRunError 경로는 stdout/stderr만 쓰므로 구조적으로 보장되고, 그 밖의 예외는
  // e.message가 그대로 오므로 runWithStdin이 항상 감싸는다는 규약에 의존한다.
  detail: string
}
/**
 * claude CLI가 "지금 요약을 만들 수 있는 상태인가"(#8). EnvReport에 claude가 없는 이유는
 * 증명 범위와 비용이 다르기 때문이다 — `which claude`는 설치만 증명하고 즉시·무료지만, 로그인·
 * 사용량은 실제로 한 번 실행해 봐야만 알 수 있고 수 초가 걸리며 사용자의 사용량을 소모한다.
 *
 * undetermined를 unavailable과 반드시 나눈다. "못 쓴다"는 사용자가 할 일이 있다는 뜻이고
 * "판정 못 했다"는 없다는 뜻인데, 둘을 한 값으로 뭉개면 콜드 스타트 한 번이 느렸다는 이유로
 * 멀쩡한 CLI에 상시 경고가 붙는다. 캐시에 남길지, 안내 카드를 띄울지가 여기서 갈린다.
 */
export type ClaudeStatus =
  | { kind: 'available' }
  | { kind: 'unavailable'; failure: SummaryFailure }
  | { kind: 'undetermined'; failure: SummaryFailure }
/**
 * 요약 재생성 결과. 예상된 실패(claude)는 예외가 아니라 반환값으로 표현한다 —
 * ipcMain.handle이 예외를 renderer로 넘길 때 message만 남기고 커스텀 프로퍼티를 잃기 때문이다.
 * 파일 IO 오류는 계속 throw한다(예상 밖 예외와 섞지 않는다).
 *
 * saveWarning: 요약 자체는 성공해 파일에 썼지만 git 저장·동기화가 실패한 경우. 이걸 throw하면
 * "요약 생성 실패"로 오보되는데(요약은 디스크에 있다) 삼키면 커밋 누락을 아무도 모른다.
 */
export type RegenerateResult =
  | { ok: true; meeting: Meeting; saveWarning?: string }
  | { ok: false; failure: SummaryFailure }
// 개인 로스터(v0.4.0 ③a) — 회사 명단(teams 구조)을 폐기하고 사용자별 ~/.minit/participants.json에
// 저장하는 평평한 이름 목록으로 재컨셉했다. 팀 구조·한글 이름 병기는 더 이상 없다.
export interface Roster { participants: string[] }
export interface AppSettings {
  repoRoot: string; autoPush: boolean
  // Slack 봇 토큰 자체는 절대 렌더러로 반환하지 않는다(slack:tokenState의 saved만 노출).
  // slackChannelId는 "기본 알림 채널" — 자동 발송 여부는 slackAutoSend가 별도로 정한다.
  slackChannelId: string | null; slackChannelName: string | null; slackPromptShown: boolean
  slackAutoSend: boolean
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

/**
 * 자동 업데이트 확인의 건강 상태. 이 앱의 유일한 배포 채널이 업데이터라, 자동 확인이 계속
 * 실패하면 사용자는 구버전에 고립된 채 아무 신호도 못 받는다 — 설정에서 알려주기 위한 값이다.
 * lastSuccessAt=0은 이 실행에서 아직 성공한 적 없음을 뜻한다.
 */
export interface AutoCheckStatus {
  lastSuccessAt: number
  consecutiveFailures: number
  lastError: 'feed_unreachable' | 'other' | null
}

// Slack 멤버 동기화 — users.list에서 가져온 워크스페이스 멤버. 회의 시작 화면의 Slack 참석자
// 후보이자, 발송 시 담당자를 멘션(<@id>)으로 치환하는 근거다.
//
// name은 표시용 폴백 체인(display_name → profile.real_name → real_name → name)의 결과이며,
// 동시에 이 기능 전체의 **식별 키**다 — 참석자 선택·회의록 저장·담당자 매칭이 모두 name으로
// 이뤄지고 id는 멘션 치환에만 쓰인다. 따라서 목록 안에서 name이 유일해야 하며, 중복이면
// 누구인지 확정할 수 없으므로 findMentionId가 멘션을 포기한다.
export interface SlackMember { id: string; name: string }

// 동기화 실패 사유. 렌더러가 에러 문자열을 정규식·includes로 되짚지 않도록 main에서 분류한다
// (SummaryFailureReason과 동일한 관례 — 문자열 매칭은 API 문구 변경에 취약해 이 레포가 폐기했다).
export type SlackSyncErrorReason =
  | 'no_token'       // 봇 토큰 미등록
  | 'missing_scope'  // users:read 미보유 — 재설치 안내 대상
  | 'auth'           // invalid_auth·account_inactive 등 토큰 자체 문제
  | 'network'        // 오프라인·타임아웃·HTTP 오류
  | 'unknown'        // 그 외 — detail 원문을 그대로 보여준다
export interface SlackSyncError { reason: SlackSyncErrorReason; detail: string }

// 파일(~/.minit/slack-members.json)에 저장되는 형태. syncedAt이 null이면 아직 한 번도 성공하지
// 않은 것이다(빈 문자열 센티널 대신 null — 레포 전반의 "없음" 표현 관례를 따른다).
// lastError를 함께 저장하는 이유: 기동 시 백그라운드 동기화가 실패해도 그 사유가 남아야
// 사용자가 설정 화면을 열었을 때 원인(예: users:read 누락)을 볼 수 있다.
export interface SlackMembers {
  members: SlackMember[]
  syncedAt: string | null
  lastError: SlackSyncError | null
}
// 렌더러 노출용 — 저장된 형태 그대로다. 별도 타입을 두지 않고 확장으로 관계를 명시한다.
export type SlackMembersState = SlackMembers
