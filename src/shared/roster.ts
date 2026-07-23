import type { Roster } from './types'

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

// JSON.parse 후 { participants: string[] } 형태를 검증한다. 형태가 어긋나면 throw — 호출부
// (main/roster.ts)가 null로 폴백해 앱이 죽지 않도록 한다.
export function parseRoster(raw: string): Roster {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('roster: 객체가 아니다')
  const { participants } = parsed as Record<string, unknown>
  if (!Array.isArray(participants)) throw new Error('roster.participants: 배열이 아니다')
  participants.forEach((p, i) => {
    if (!isString(p)) throw new Error(`participants[${i}]: 문자열이 아니다`)
  })
  return { participants: participants as string[] }
}

// trim·빈값 제거 후 대소문자 무시 dedup(첫 표기 승리) + 한국어 정렬. 로스터 전 함수의 공용 정규화.
export function dedupeAndSort(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const n = raw.trim()
    if (n === '') continue
    const lower = n.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(n)
  }
  return out.sort((a, b) => a.localeCompare(b, 'ko'))
}

// 붙여넣기/파일 입력을 이름 배열로 파싱한다. { 또는 [ 로 시작하면 JSON으로 인식하고(객체는
// parseRoster로 검증, 배열은 문자열 배열로), 아니면 줄바꿈·쉼표 구분 평문으로 처리한다.
// 항상 dedupeAndSort로 정규화. 깨진 JSON은 JSON.parse/parseRoster가 throw한다.
export function parseImportInput(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed === '') return []
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown
    if (!Array.isArray(parsed)) throw new Error('JSON 배열이 아니다')
    return dedupeAndSort(parsed.map(String))
  }
  if (trimmed.startsWith('{')) {
    return dedupeAndSort(parseRoster(trimmed).participants)
  }
  return dedupeAndSort(trimmed.split(/[\n,]/))
}

// 기존 로스터에 없는 이름만 병합하고, 미리보기용으로 신규/중복(건너뜀) 수를 함께 반환한다.
export function mergeNames(
  roster: Roster,
  incoming: string[]
): { roster: Roster; addedCount: number; skippedCount: number } {
  const existingLower = new Set(roster.participants.map((n) => n.toLowerCase()))
  const uniqueIncoming = dedupeAndSort(incoming)
  const additions = uniqueIncoming.filter((n) => !existingLower.has(n.toLowerCase()))
  return {
    roster: { participants: dedupeAndSort([...roster.participants, ...additions]) },
    addedCount: additions.length,
    skippedCount: uniqueIncoming.length - additions.length
  }
}

// 자유입력(게스트 추가 등)으로 들어온 이름을 로스터 기준 canonical 표기로 정규화한다.
// trim 후 대소문자 무시 exact 매칭되는 이름이 있으면 로스터에 저장된 원본 표기를 반환하고,
// 없거나 roster가 없으면 trim된 input을 그대로 반환한다(자유입력 폴백 유지).
export function resolveMemberName(roster: Roster | null, input: string): string {
  const trimmed = input.trim()
  if (!roster) return trimmed
  const found = roster.participants.find((p) => p.toLowerCase() === trimmed.toLowerCase())
  return found ?? trimmed
}

// from(대소문자 무시)을 to 표기로 변경. to가 빈값이거나 from이 없으면 원본 유지. to가 다른 기존
// 항목과 충돌하면, from을 제거하고 to를 뒤에 붙인 뒤 dedupeAndSort로 병합해 기존 항목 표기가
// 이기게 한다(mergeNames와 동일한 "기존 항목 승리" 규칙 — 위치 의존성 제거).
export function renameParticipant(roster: Roster, from: string, to: string): Roster {
  const toTrim = to.trim()
  if (toTrim === '') return roster
  const fromLower = from.trim().toLowerCase()
  const idx = roster.participants.findIndex((n) => n.toLowerCase() === fromLower)
  if (idx === -1) return roster
  const next = roster.participants.filter((n) => n.toLowerCase() !== fromLower)
  next.push(toTrim)
  return { participants: dedupeAndSort(next) }
}

export function removeParticipant(roster: Roster, name: string): Roster {
  const lower = name.trim().toLowerCase()
  return { participants: roster.participants.filter((n) => n.toLowerCase() !== lower) }
}
