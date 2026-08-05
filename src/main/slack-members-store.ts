import path from 'node:path'
import { parseSlackMembers } from '../shared/slack-members'
import type { SlackMember, SlackMembers } from '../shared/types'

const EMPTY: SlackMembers = { members: [], syncedAt: '' }

// Slack 워크스페이스 멤버 캐시. participants.json(슬랙과 무관한 개인 명단)과 분리해 두는 이유는
// 워크스페이스 종속 데이터이기 때문이다 — 토큰 해제 시 함께 지워야 생애주기가 맞고,
// 로스터 Export에 다른 워크스페이스에서 무의미한 ID가 섞이지 않는다.
export function slackMembersFile(configDir: string): string {
  return path.join(configDir, 'slack-members.json')
}

// 파일 없음·읽기 실패·손상 모두 빈 목록으로 흡수한다 — 멤버 목록은 부가 기능이라 앱 기동을
// 막으면 안 된다(roster.ts의 null 폴백과 같은 관례).
export function loadSlackMembers(
  configDir: string,
  fileExists: (p: string) => boolean,
  readFile: (p: string) => string
): SlackMembers {
  const file = slackMembersFile(configDir)
  if (!fileExists(file)) return EMPTY
  try {
    return parseSlackMembers(readFile(file))
  } catch {
    return EMPTY
  }
}

export function saveSlackMembers(
  configDir: string,
  members: SlackMember[],
  syncedAt: string,
  writeFile: (p: string, content: string) => void
): SlackMembers {
  const payload: SlackMembers = { members, syncedAt }
  writeFile(slackMembersFile(configDir), JSON.stringify(payload, null, 2))
  return payload
}

export function deleteSlackMembers(configDir: string, rm: (p: string) => void): void {
  rm(slackMembersFile(configDir))
}
