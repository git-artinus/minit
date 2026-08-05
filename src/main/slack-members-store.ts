import path from 'node:path'
import { classifySyncError, parseSlackMembers } from '../shared/slack-members'
import type { SlackMember, SlackMembers } from '../shared/types'

const EMPTY: SlackMembers = { members: [], syncedAt: null, lastError: null }

// Slack 워크스페이스 멤버 캐시. participants.json(슬랙과 무관한 개인 명단)과 분리해 두는 이유는
// 워크스페이스 종속 데이터이기 때문이다 — 토큰 해제 시 함께 지워야 생애주기가 맞고, 로스터
// Export에 다른 워크스페이스의 표시이름이 섞여 나가지 않는다.
export function slackMembersFile(configDir: string): string {
  return path.join(configDir, 'slack-members.json')
}

// 파일 없음·읽기 실패·손상 모두 빈 목록으로 흡수한다 — 멤버 목록은 부가 기능이라 앱 기동을
// 막으면 안 된다(roster.ts의 null 폴백과 같은 관례). 다만 조용히 넘기지는 않는다: 손상된
// 파일이 영구히 빈 목록으로 읽히면 멘션이 이유 없이 평문으로 강등되므로 로그를 남긴다.
// existsSync도 try 안에 둔다 — 상위 디렉터리 권한 문제(EACCES)면 이 호출부터 던진다.
export function loadSlackMembers(
  configDir: string,
  fileExists: (p: string) => boolean,
  readFile: (p: string) => string,
  log: (...args: unknown[]) => void = console.error
): SlackMembers {
  const file = slackMembersFile(configDir)
  try {
    if (!fileExists(file)) return EMPTY
    return parseSlackMembers(readFile(file))
  } catch (e) {
    log('[slack] 멤버 목록 읽기 실패:', e instanceof Error ? e.message : e)
    return EMPTY
  }
}

export function saveSlackMembers(
  configDir: string,
  payload: SlackMembers,
  writeFile: (p: string, content: string) => void
): SlackMembers {
  writeFile(slackMembersFile(configDir), JSON.stringify(payload, null, 2))
  return payload
}

export function deleteSlackMembers(configDir: string, rm: (p: string) => void): void {
  rm(slackMembersFile(configDir))
}

export interface SyncSlackMembersDeps {
  loadStored: () => SlackMembers
  loadToken: () => string | null
  fetchMembers: (token: string) => Promise<SlackMember[]>
  save: (payload: SlackMembers) => SlackMembers
  now: () => string
  log?: (...args: unknown[]) => void
}

// 동기화 본체. ipc.ts가 아니라 여기 두는 이유는 분기가 넷이고(토큰 없음·성공·실패·저장) 각각이
// 회귀 시 사용자에게 신호 없이 기능을 없애는 종류라 테스트가 필요하기 때문이다.
//
// 실패해도 기존 저장분을 유지한다 — 오프라인·스코프 미보유에서도 회의 시작 화면이 동작해야
// 한다. 대신 사유를 파일에 함께 남긴다: 기동 시 백그라운드 동기화가 실패했을 때 그 사유가
// 남아 있어야 나중에 설정 화면을 열었을 때 원인(예: users:read 누락)을 볼 수 있다.
export async function syncSlackMembers(deps: SyncSlackMembersDeps): Promise<SlackMembers> {
  const stored = deps.loadStored()
  const token = deps.loadToken()
  if (!token) {
    return deps.save({ ...stored, lastError: { reason: 'no_token', detail: '' } })
  }

  try {
    const members = await deps.fetchMembers(token)
    return deps.save({ members, syncedAt: deps.now(), lastError: null })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    deps.log?.('[slack] 멤버 동기화 실패:', message)
    return deps.save({ ...stored, lastError: classifySyncError(message) })
  }
}
