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

// 자유입력(게스트 추가 등)으로 들어온 이름을 로스터 기준 canonical 표기로 정규화한다.
// trim 후 대소문자 무시 exact 매칭되는 이름이 있으면 로스터에 저장된 원본 표기를 반환하고,
// 없거나 roster가 없으면 trim된 input을 그대로 반환한다(자유입력 폴백 유지).
export function resolveMemberName(roster: Roster | null, input: string): string {
  const trimmed = input.trim()
  if (!roster) return trimmed
  const found = roster.participants.find((p) => p.toLowerCase() === trimmed.toLowerCase())
  return found ?? trimmed
}
