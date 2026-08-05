import matter from 'gray-matter'
import type { ActionItem, Meeting, MeetingSection, TranscriptSegment } from './types'

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
  return `${now.getMonth() + 1}월 ${now.getDate()}일 회의록`
}

// 회의록 frontmatter date(ISO8601 +09:00)에서 시작 시각 HH:mm만 뽑는다. 저장된 오프셋 표기를
// 그대로 읽어(문자열 파싱) 뷰어 타임존에 영향받지 않는다.
export function formatStartTime(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso)
  return m ? `${m[1]}:${m[2]}` : ''
}

// 요약의 문단 경계는 빈 줄이다(마크다운 규약). 렌더러가 문단마다 <p>를 만들 때 쓴다 —
// 단일 <p>에 그대로 넣으면 HTML이 개행을 공백으로 접어 문단 구분이 사라진다.
export function summaryParagraphs(summary: string): string[] {
  return summary
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
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

// 공유 포맷(share-format.ts)도 이 규칙을 그대로 쓴다 — 섹션 렌더가 두 벌로 갈라지지 않게 export한다.
export function serializeSection(s: MeetingSection): string {
  const body =
    s.kind === 'actions'
      ? s.items.map(serializeActionItem).join('\n')
      : s.kind === 'list'
        ? s.items.map((i) => `- ${i}`).join('\n')
        : s.text
  return `## ${s.heading}\n\n${body}`.trimEnd()
}

export function serializeMeeting(m: Omit<Meeting, 'filename'>): string {
  // frontmatter는 js-yaml(gray-matter 내장) 직렬화로 생성한다 — 문자열 연결 방식은
  // title에 ':'·'#'·','가 들어가면 파싱 실패(THROW)나 값 손실(잘림)을 일으킨다.
  // recorder는 있을 때만 최상단에 둔다(v0.4.0 ③b) — 없으면(비로그인) 필드 자체를 생략한다.
  const fm = matter.stringify('', {
    ...(m.recorder ? { recorder: m.recorder } : {}),
    title: m.title,
    date: m.date,
    duration: `${m.durationMin}m`,
    type: m.meetingType,
    participants: m.participants,
    ...(m.transcriptFlagged ? { transcriptFlagged: true } : {}),
  }).trim()
  const summary = `## 요약\n\n${m.summary}`.trimEnd()
  const sections = m.sections.map(serializeSection).join('\n\n')
  const transcript = `## 트랜스크립트\n\n${m.segments
    .map((s) => `${formatTimestamp(s.startMs)} ${s.text}`)
    .join('\n')}`.trimEnd()
  return [fm, summary, sections, transcript].filter((part) => part !== '').join('\n\n') + '\n'
}

export function parseMeeting(filename: string, raw: string): Meeting {
  const { data, content } = matter(raw)
  const ordered = splitSections(content)
  const find = (h: string): string[] => ordered.find(([k]) => k === h)?.[1] ?? []
  const segments: TranscriptSegment[] = find('트랜스크립트')
    .map((line) => SEGMENT_RE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ startMs: parseTimestamp(m[1]), text: m[2] }))
  // 요약·트랜스크립트를 제외한 모든 헤딩을 섹션으로 취급한다. kind는 파일에 기록하지 않고
  // (사람이 읽는 마크다운 유지) 내용으로 추론한다 — 구파일(액션아이템)도 이 규칙으로 흡수된다.
  const sections: MeetingSection[] = ordered
    .filter(([h]) => h !== '요약' && h !== '트랜스크립트')
    .map(([heading, lines]) => inferSection(heading, lines))
  return {
    filename,
    ...(typeof data.recorder === 'string' ? { recorder: data.recorder } : {}),
    meetingType: typeof data.type === 'string' ? data.type : 'general',
    title: String(data.title ?? ''),
    date: typeof data.date === 'string' ? data.date : (data.date instanceof Date ? data.date.toISOString() : String(data.date ?? '')),
    durationMin: parseInt(String(data.duration ?? '0'), 10),
    participants: Array.isArray(data.participants) ? data.participants.map(String) : [],
    summary: find('요약').join('\n').trim(),
    sections,
    segments,
    ...(data.transcriptFlagged === true ? { transcriptFlagged: true as const } : {}),
  }
}

function inferSection(heading: string, lines: string[]): MeetingSection {
  // kind 판정과 항목 추출은 빈 줄을 빼고 한다 — 손으로 편집한 파일의 빈 줄 하나가
  // every(startsWith('- '))를 깨뜨려 list를 text로 오판시킨다.
  const content = lines.filter((l) => l.trim() !== '')
  if (content.some((l) => ACTION_RE.test(l))) {
    const items: ActionItem[] = content
      .map((l) => ACTION_RE.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ text: m[1], ...(m[2] ? { assignee: m[2] } : {}), ...(m[3] ? { due: m[3] } : {}) }))
    return { heading, kind: 'actions', items }
  }
  if (content.length > 0 && content.every((l) => l.startsWith('- '))) {
    return { heading, kind: 'list', items: content.map((l) => l.slice(2)) }
  }
  // text kind는 문단 구분(빈 줄)이 내용의 일부다 — 걸러내지 않은 원본을 쓴다.
  return { heading, kind: 'text', text: lines.join('\n') }
}

// 순서 보존 — 섹션 배열 모델은 파일에 적힌 순서가 곧 표시 순서다.
// 헤딩 직후·다음 헤딩 직전의 빈 줄은 마크다운 구분자이지 내용이 아니다. 본문 사이 빈 줄만
// 남긴다 — 요약을 문단으로 나눠 저장해도 다시 읽을 때 문단 경계가 살아 있어야 한다.
function trimBlankEdges(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start++
  while (end > start && lines[end - 1].trim() === '') end--
  return lines.slice(start, end)
}

function splitSections(content: string): [string, string[]][] {
  const sections: [string, string[]][] = []
  let current: string[] | null = null
  for (const line of content.split('\n')) {
    const h = /^## (.+)$/.exec(line)
    if (h) {
      current = []
      sections.push([h[1].trim(), current])
    } else if (current) {
      current.push(line)
    }
  }
  return sections.map(([heading, lines]): [string, string[]] => [heading, trimBlankEdges(lines)])
}
