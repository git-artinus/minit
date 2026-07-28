import { formatTimestamp } from '../../shared/meeting-file'
import type { ActionItem, MeetingSection, TranscriptSegment } from '../../shared/types'
import type { MeetingTypeDef } from '../../shared/meeting-types'

export interface SummaryResult { summary: string; sections: MeetingSection[] }
export type RunWithStdin = (
  cmd: string, args: string[], stdin: string, timeoutMs?: number
) => Promise<{ stdout: string }>

export function buildPrompt(typeDef: MeetingTypeDef, title: string, participants: string[]): string {
  const sectionKeys = typeDef.sectionDefs.map((d) => `"${d.heading}"`).join(', ')
  const sectionsSchema =
    typeDef.sectionDefs.length > 0
      ? `"sections": {${typeDef.sectionDefs
          .map((d) =>
            d.kind === 'actions'
              ? `"${d.heading}": [{"text": "할 일", "assignee": "담당자(언급된 경우만)", "due": "기한(언급된 경우만)"}]`
              : d.kind === 'list'
                ? `"${d.heading}": ["항목", "..."]`
                : `"${d.heading}": "서술"`
          )
          .join(', ')}}`
      : `"sections": {}`
  const roster =
    participants.length > 0
      ? `참석자 명단: ${participants.join(', ')}. 트랜스크립트는 음성 인식 결과라 사람 이름이 오인식됐을 수 있다. 명백히 오인식된 이름만 이 명단의 표기로 교정하고, 불확실하면 원문을 유지하라. 명단에 없는 이름을 지어내지 마라.`
      : ''
  return [
    `다음은 "${title}" 회의의 타임라인 트랜스크립트다.`,
    typeDef.promptGuidance,
    roster,
    '아래 JSON 스키마로만 응답하라. 다른 텍스트를 붙이지 마라.',
    `{"summary": "회의 핵심을 3~6문장의 한국어로 요약", ${sectionsSchema}}`,
    typeDef.sectionDefs.length > 0
      ? `sections의 키는 정확히 [${sectionKeys}]로 하라. 해당 내용이 없으면 빈 배열로 두라.`
      : '',
    '트랜스크립트에 없는 내용을 지어내지 마라.',
  ]
    .filter((l) => l !== '')
    .join('\n')
}

/**
 * claude가 exit 0으로 정상 종료했는데 출력이 JSON 스키마를 벗어난 경우.
 * 응답 원문을 발췌해 실어 보낸다 — 이걸 버리면 "왜 실패했는지"를 알 방법이 사라진다.
 */
export class InvalidOutputError extends Error {
  readonly excerpt: string
  constructor(stdout: string) {
    super('claude 응답에서 JSON을 찾지 못했다')
    this.name = 'InvalidOutputError'
    this.excerpt = stdout.trim().slice(0, 300)
  }
}

interface RawOutput { summary: string; sections?: Record<string, unknown> }

function isValidShape(value: unknown): value is RawOutput {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as Partial<RawOutput>).summary === 'string'
}

function tryParse(candidate: string): RawOutput | null {
  try {
    const parsed: unknown = JSON.parse(candidate)
    return isValidShape(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 첫 `{` 부터 문자열 리터럴·이스케이프를 무시하며 깊이를 세어, 짝이 맞는 `}` 까지의 부분 문자열들을 후보로 반환한다. */
function findBalancedJsonCandidates(text: string): string[] {
  const candidates: string[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let j = i; j < text.length; j++) {
      const ch = text[j]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          candidates.push(text.slice(i, j + 1))
          break
        }
      }
    }
  }
  return candidates
}

// LLM 출력이 스키마와 어긋나도 최대한 수용한다 — 문자열 원소는 text만 있는 액션아이템으로 취급.
function sanitizeActionItems(items: unknown[]): ActionItem[] {
  const result: ActionItem[] = []
  for (const item of items) {
    if (typeof item === 'string') {
      if (item.trim().length > 0) result.push({ text: item.trim() })
      continue
    }
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.text !== 'string' || record.text.length === 0) continue
    const sanitized: ActionItem = { text: record.text }
    if (typeof record.assignee === 'string' && record.assignee.length > 0) sanitized.assignee = record.assignee
    if (typeof record.due === 'string' && record.due.length > 0) sanitized.due = record.due
    result.push(sanitized)
  }
  return result
}

export function parseClaudeOutput(stdout: string, typeDef: MeetingTypeDef): SummaryResult {
  const fenceMatch = stdout.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const parsed =
    (fenceMatch ? tryParse(fenceMatch[1].trim()) : null) ??
    findBalancedJsonCandidates(stdout).reduce<RawOutput | null>(
      (found, candidate) => found ?? tryParse(candidate),
      null
    )
  if (!parsed) throw new InvalidOutputError(stdout)
  // 섹션 kind는 LLM 출력이 아니라 타입 정의에서 온다 — 키 누락·형식 이탈에도 구조가 무너지지 않는다.
  const raw: Record<string, unknown> =
    typeof parsed.sections === 'object' && parsed.sections !== null ? parsed.sections : {}
  const sections: MeetingSection[] = typeDef.sectionDefs.map((def) => {
    const v = raw[def.heading]
    if (def.kind === 'actions') {
      return { heading: def.heading, kind: 'actions', items: sanitizeActionItems(Array.isArray(v) ? v : []) }
    }
    if (def.kind === 'list') {
      return {
        heading: def.heading,
        kind: 'list',
        items: Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [],
      }
    }
    return { heading: def.heading, kind: 'text', text: typeof v === 'string' ? v : '' }
  })
  return { summary: parsed.summary, sections }
}

export async function summarize(deps: {
  run: RunWithStdin
  title: string
  segments: TranscriptSegment[]
  participants: string[]
  typeDef: MeetingTypeDef
}): Promise<SummaryResult> {
  const transcript = deps.segments
    .map((s) => `${formatTimestamp(s.startMs)} ${s.text}`)
    .join('\n')
  const { stdout } = await deps.run(
    'claude',
    ['-p', buildPrompt(deps.typeDef, deps.title, deps.participants)],
    transcript
  )
  return parseClaudeOutput(stdout, deps.typeDef)
}
