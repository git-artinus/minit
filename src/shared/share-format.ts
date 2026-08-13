import { formatStartTime, formatTimestamp, parseMeeting, serializeSection } from './meeting-file'
import { meetingTypeDef } from './meeting-types'
import type { ActionItem, Meeting, MeetingSection, TranscriptSegment } from './types'

// 공유용 페이로드 조립 — 순수 함수. 클립보드 복사(요약 마크다운·트랜스크립트 평문)와
// .txt 내보내기(평문)가 여기서 나온다.
// Slack 발송은 mrkdwn 이스케이프가 필요해 slack.ts가 따로 담당한다.

// 저장된 오프셋 표기를 문자열로 읽는다(뷰어 타임존 무관) — MeetingDetail 표시 방식과 동일하다.
function metaLine(m: Meeting): string {
  const participants = m.participants.length > 0 ? `참석자: ${m.participants.join(', ')}` : '참석자 없음'
  const label = meetingTypeDef(m.meetingType).label
  return `${m.date.slice(0, 10)} ${formatStartTime(m.date)} · ${m.durationMin}분 · ${label} · ${participants}`
}

function isEmptySection(s: MeetingSection): boolean {
  return s.kind === 'text' ? s.text.trim() === '' : s.items.length === 0
}

// 요약 + 섹션 마크다운. 트랜스크립트는 담지 않는다(공유 상대가 읽을 분량이 아니다).
export function buildShareMarkdown(m: Meeting): string {
  const blocks = [`# ${m.title}`, metaLine(m)]
  if (m.summary.trim() !== '') blocks.push(`## 요약\n\n${m.summary.trim()}`)
  for (const s of m.sections) {
    if (!isEmptySection(s)) blocks.push(serializeSection(s))
  }
  return blocks.join('\n\n')
}

function plainActionItem(item: ActionItem): string {
  let line = `- ${item.text}`
  if (item.assignee) line += ` (담당: ${item.assignee})`
  if (item.due) line += ` (기한: ${item.due})`
  return line
}

// 평문 섹션 본문 — 마크다운 기호(체크박스)를 걷어내고 불릿만 남긴다.
function plainSectionBody(s: MeetingSection): string {
  if (s.kind === 'actions') return s.items.map(plainActionItem).join('\n')
  if (s.kind === 'list') return s.items.map((i) => `- ${i}`).join('\n')
  return s.text.trim()
}

function plainBlock(heading: string, body: string): string {
  return `== ${heading} ==\n\n${body}`
}

// .txt 내보내기용 평문. 트랜스크립트까지 포함하는 전체 사본이다.
// 헤딩을 '== x =='로 감싸는 이유: 트랜스크립트 타임스탬프가 '[HH:MM:SS]'라 대괄호 표기와 섞이면
// 구분이 흐려진다.
export function buildPlainText(m: Meeting): string {
  const blocks = [`${m.title}\n${metaLine(m)}`]
  if (m.summary.trim() !== '') blocks.push(plainBlock('요약', m.summary.trim()))
  for (const s of m.sections) {
    if (!isEmptySection(s)) blocks.push(plainBlock(s.heading, plainSectionBody(s)))
  }
  if (m.segments.length > 0) {
    const lines = m.segments.map((s) => `${formatTimestamp(s.startMs)} ${s.text}`).join('\n')
    blocks.push(plainBlock('트랜스크립트', lines))
  }
  return blocks.join('\n\n')
}

// 트랜스크립트만 담는 평문. MeetingDetail이 화면에 렌더하는 병합 문단 배열을 그대로 받는다 —
// 여기서 다시 mergeParagraphs를 부르면 병합 조건이 바뀔 때 화면과 복사 결과가 조용히 어긋난다.
export function buildTranscriptText(paragraphs: TranscriptSegment[]): string {
  return paragraphs.map((p) => `${formatTimestamp(p.startMs)} ${p.text}`).join('\n')
}

export type ExportFormat = 'md' | 'txt'

export function exportFileName(filename: string, format: ExportFormat): string {
  return format === 'md' ? filename : filename.replace(/\.md$/, '') + '.txt'
}

// 내보내기 본문. md는 저장된 원본 그대로(frontmatter 포함) — 다른 도구·minit이 다시 읽을 수 있는
// 완전한 사본이다. txt는 원본을 파싱해 평문으로 다시 조립한다.
export function exportContent(filename: string, raw: string, format: ExportFormat): string {
  return format === 'md' ? raw : buildPlainText(parseMeeting(filename, raw)) + '\n'
}
