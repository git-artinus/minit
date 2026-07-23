import path from 'node:path'
import { dedupeAndSort, mergeNames, parseRoster } from '../shared/roster'
import type { Roster } from '../shared/types'

// 개인 로스터(v0.4.0 ③a) — 레포 공용 participants.json(회사 명단)을 폐기하고 사용자 홈
// (settings.minitHome())의 ~/.minit/participants.json에 저장하는 개인용 평평한 이름 목록으로
// 재컨셉했다. configDir은 항상 minitHome()이 넘어온다(repoRoot 아님).
function rosterFile(configDir: string): string {
  return path.join(configDir, 'participants.json')
}

// ~/.minit/participants.json을 읽어 Roster로 파싱한다. 파일이 없거나 형태가 어긋나면
// null을 반환해 렌더러가 기존 자유 입력 UI로 폴백할 수 있게 한다(roster는 선택적 기능).
export function loadRoster(
  configDir: string,
  fileExists: (p: string) => boolean,
  readFile: (p: string) => string
): Roster | null {
  const file = rosterFile(configDir)
  if (!fileExists(file)) return null
  try {
    return parseRoster(readFile(file))
  } catch {
    return null
  }
}

export function saveRoster(configDir: string, roster: Roster, writeFile: (p: string, content: string) => void): void {
  writeFile(rosterFile(configDir), JSON.stringify(roster, null, 2))
}

// 최초 실행 시(로스터 파일이 아직 없을 때) 기존 회의록 참석자로 1회 시드한다. collectExistingParticipants는
// 이미 loadMeetings+collectParticipants로 수집된 결과를 동기적으로 반환하는 콜백이다(호출부인
// ipc.ts가 비동기 loadMeetings를 먼저 await한 뒤 이 함수를 호출한다).
export function seedRosterIfMissing(
  configDir: string,
  deps: {
    fileExists: (p: string) => boolean
    readFile: (p: string) => string
    writeFile: (p: string, content: string) => void
    collectExistingParticipants: () => string[]
  }
): Roster {
  const file = rosterFile(configDir)
  if (deps.fileExists(file)) {
    return loadRoster(configDir, deps.fileExists, deps.readFile) ?? { participants: [] }
  }
  const sorted = dedupeAndSort(deps.collectExistingParticipants())
  const roster: Roster = { participants: sorted }
  saveRoster(configDir, roster, deps.writeFile)
  return roster
}

// 회의 시작 시(StartMeetingModal start()) 최종 participants 중 로스터에 없는 이름을 등록한다
// (대소문자 무시 중복 제거, 정렬 유지). 추가할 이름이 없으면 디스크를 건드리지 않는다.
export function addParticipants(
  current: Roster | null,
  names: string[],
  writeFile: (p: string, content: string) => void,
  configDir: string
): Roster {
  const { roster, addedCount } = mergeNames(current ?? { participants: [] }, names)
  if (addedCount === 0) return current ?? { participants: [] }
  saveRoster(configDir, roster, writeFile)
  return roster
}

export { dedupeAndSort, mergeNames, parseImportInput, removeParticipant, renameParticipant } from '../shared/roster'
