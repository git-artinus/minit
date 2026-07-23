import { formatTimestamp } from '../../shared/meeting-file'
import type { ActionItem, TranscriptSegment } from '../../shared/types'

export interface SummaryResult { summary: string; actionItems: ActionItem[] }
export type RunWithStdin = (cmd: string, args: string[], stdin: string) => Promise<{ stdout: string }>

export function buildPrompt(title: string): string {
  return [
    `다음은 "${title}" 회의의 타임라인 트랜스크립트다.`,
    '아래 JSON 스키마로만 응답하라. 다른 텍스트를 붙이지 마라.',
    '{"summary": "회의 핵심 논의·결정 사항을 3~6문장의 한국어로 요약",',
    ' "actionItems": [{"text": "할 일", "assignee": "담당자(언급된 경우만)", "due": "기한(언급된 경우만)"}]}',
    '액션아이템이 없으면 빈 배열로 응답하라. 트랜스크립트에 없는 내용을 지어내지 마라.',
  ].join('\n')
}

function isValidShape(value: unknown): value is Partial<SummaryResult> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<SummaryResult>
  return typeof candidate.summary === 'string' && Array.isArray(candidate.actionItems)
}

function tryParse(candidate: string): Partial<SummaryResult> | null {
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

function sanitizeActionItems(items: unknown[]): ActionItem[] {
  const result: ActionItem[] = []
  for (const item of items) {
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

export function parseClaudeOutput(stdout: string): SummaryResult {
  const fenceMatch = stdout.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const parsed = (fenceMatch ? tryParse(fenceMatch[1].trim()) : null)
    ?? findBalancedJsonCandidates(stdout).reduce<Partial<SummaryResult> | null>(
      (found, candidate) => found ?? tryParse(candidate),
      null,
    )
  if (!parsed) throw new Error('claude 응답에서 JSON을 찾지 못했다')
  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.actionItems)) {
    throw new Error('claude 응답 JSON이 스키마와 다르다')
  }
  return { summary: parsed.summary, actionItems: sanitizeActionItems(parsed.actionItems) }
}

export async function summarize(deps: {
  run: RunWithStdin
  title: string
  segments: TranscriptSegment[]
}): Promise<SummaryResult> {
  const transcript = deps.segments
    .map((s) => `${formatTimestamp(s.startMs)} ${s.text}`)
    .join('\n')
  const { stdout } = await deps.run('claude', ['-p', buildPrompt(deps.title)], transcript)
  return parseClaudeOutput(stdout)
}
