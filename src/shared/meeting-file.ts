import matter from 'gray-matter'
import type { ActionItem, Meeting, TranscriptSegment } from './types'

// meetings/ 하위 파일만 다루도록 filename을 보수적으로 검증한다 (경로 이탈 방지).
// ipc.ts(summary:regenerate)와 github/api.ts(uploadMeeting) 양쪽이 공유한다.
export function isValidMeetingFilename(filename: string): boolean {
  return filename.endsWith('.md') && !filename.includes('/') && !filename.includes('\\') && !filename.includes('..')
}

export function meetingFilename(title: string, date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const slug = title
    .replace(/[\\/:*?"<>|#%{}^~[\]`;@&=+$,!'()]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  return `${y}-${m}-${d}-${slug || '회의'}.md`
}

export function localIsoNow(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const y = now.getFullYear()
  const mo = pad(now.getMonth() + 1)
  const d = pad(now.getDate())
  const h = pad(now.getHours())
  const mi = pad(now.getMinutes())
  const s = pad(now.getSeconds())
  const offsetMin = -now.getTimezoneOffset() // getTimezoneOffset은 UTC-로컬(분)이라 부호 반전
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const offH = pad(Math.floor(abs / 60))
  const offM = pad(abs % 60)
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${offH}:${offM}`
}

export function defaultMeetingTitle(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `회의 ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
}

export function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = String(Math.floor(total / 3600)).padStart(2, '0')
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `[${h}:${m}:${s}]`
}

function parseTimestamp(ts: string): number {
  const [h, m, s] = ts.split(':').map(Number)
  return ((h * 3600 + m * 60 + s) * 1000)
}

function serializeActionItem(item: ActionItem): string {
  let line = `- [ ] ${item.text}`
  if (item.assignee) line += ` (담당: ${item.assignee})`
  if (item.due) line += ` (기한: ${item.due})`
  return line
}

const ACTION_RE = /^- \[[ x]\] (.+?)(?: \(담당: ([^)]+)\))?(?: \(기한: ([^)]+)\))?$/
const SEGMENT_RE = /^\[(\d{2}:\d{2}:\d{2})\] (.*)$/

export function serializeMeeting(m: Omit<Meeting, 'filename'>): string {
  // frontmatter는 js-yaml(gray-matter 내장) 직렬화로 생성한다 — 문자열 연결 방식은
  // title에 ':'·'#'·','가 들어가면 파싱 실패(THROW)나 값 손실(잘림)을 일으킨다.
  // recorder는 있을 때만 최상단에 둔다(v0.4.0 ③b) — 없으면(비로그인) 필드 자체를 생략한다.
  const fm = matter.stringify('', {
    ...(m.recorder ? { recorder: m.recorder } : {}),
    title: m.title,
    date: m.date,
    duration: `${m.durationMin}m`,
    participants: m.participants,
  }).trim()
  const summary = `## 요약\n\n${m.summary}`.trimEnd()
  const actions = `## 액션아이템\n\n${m.actionItems.map(serializeActionItem).join('\n')}`.trimEnd()
  const transcript = `## 트랜스크립트\n\n${m.segments
    .map((s) => `${formatTimestamp(s.startMs)} ${s.text}`)
    .join('\n')}`.trimEnd()
  return `${fm}\n\n${summary}\n\n${actions}\n\n${transcript}\n`
}

export function parseMeeting(filename: string, raw: string): Meeting {
  const { data, content } = matter(raw)
  const sections = splitSections(content)
  const actionItems: ActionItem[] = (sections['액션아이템'] ?? [])
    .map((line) => ACTION_RE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      text: m[1],
      ...(m[2] ? { assignee: m[2] } : {}),
      ...(m[3] ? { due: m[3] } : {}),
    }))
  const segments: TranscriptSegment[] = (sections['트랜스크립트'] ?? [])
    .map((line) => SEGMENT_RE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ startMs: parseTimestamp(m[1]), text: m[2] }))
  return {
    filename,
    ...(typeof data.recorder === 'string' ? { recorder: data.recorder } : {}),
    title: String(data.title ?? ''),
    date: typeof data.date === 'string' ? data.date : (data.date instanceof Date ? data.date.toISOString() : String(data.date ?? '')),
    durationMin: parseInt(String(data.duration ?? '0'), 10),
    participants: Array.isArray(data.participants) ? data.participants.map(String) : [],
    summary: (sections['요약'] ?? []).join('\n').trim(),
    actionItems,
    segments,
  }
}

function splitSections(content: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {}
  let current: string | null = null
  for (const line of content.split('\n')) {
    const h = /^## (.+)$/.exec(line)
    if (h) {
      current = h[1].trim()
      sections[current] = []
    } else if (current && line.trim() !== '') {
      sections[current].push(line)
    }
  }
  return sections
}
