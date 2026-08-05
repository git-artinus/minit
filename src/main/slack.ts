import { fetchWithTimeout } from '../shared/fetch-timeout'
import { meetingTypeDef } from '../shared/meeting-types'
import { findMentionId, membersInMeeting, toSlackMembers, type SlackApiUser } from '../shared/slack-members'
import type { ActionItem, Meeting, MeetingSection, SlackMember, SlackSendFailure } from '../shared/types'

function formatMeetingDate(dateIso: string): string {
  const d = new Date(dateIso)
  if (Number.isNaN(d.getTime())) return dateIso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Slack mrkdwn 특수문자 이스케이프. 순서 중요: &를 먼저 치환해야 뒤에 넣는 &amp;/&lt;/&gt;가
// 다시 이스케이프되지 않는다. 회의 제목·요약·참석자·액션아이템 등 사용자 유래 텍스트 전체에 적용한다.
export function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 담당자가 Slack 멤버와 완전 일치하면 멘션(<@id>)으로 바꾼다. 멘션 토큰은 escapeMrkdwn을
// 거치면 안 된다 — <,>가 &lt;,&gt;로 바뀌어 멘션이 깨진다. 그래서 이스케이프한 평문과
// 멘션 토큰을 분기해서 조립한다.
function assigneeText(assignee: string, members: SlackMember[]): string {
  const id = findMentionId(assignee, members)
  return id === null ? escapeMrkdwn(assignee) : `<@${id}>`
}

function actionItemLine(item: ActionItem, members: SlackMember[]): string {
  let line = `- [ ] ${escapeMrkdwn(item.text)}`
  if (item.assignee) line += ` (담당: ${assigneeText(item.assignee, members)})`
  if (item.due) line += ` (기한: ${escapeMrkdwn(item.due)})`
  return line
}

// 섹션 kind별 mrkdwn 렌더 — 빈 섹션은 통째로 생략한다(빈 헤딩만 남는 메시지 방지).
function sectionLines(s: MeetingSection, members: SlackMember[]): string[] {
  if (s.kind === 'actions') return s.items.length > 0 ? [`*${escapeMrkdwn(s.heading)}*`, ...s.items.map((i) => actionItemLine(i, members))] : []
  if (s.kind === 'list') return s.items.length > 0 ? [`*${escapeMrkdwn(s.heading)}*`, ...s.items.map((i) => `- ${escapeMrkdwn(i)}`)] : []
  return s.text.trim() !== '' ? [`*${escapeMrkdwn(s.heading)}*`, escapeMrkdwn(s.text)] : []
}

function buildMeetingText(meeting: Meeting, members: SlackMember[]): string {
  const participants =
    meeting.participants.length > 0 ? meeting.participants.map(escapeMrkdwn).join(', ') : '참석자 없음'
  const typeLabel = meetingTypeDef(meeting.meetingType).label
  const lines = [
    `*${escapeMrkdwn(meeting.title)}* · ${escapeMrkdwn(typeLabel)}`,
    `${formatMeetingDate(meeting.date)} · ${participants}`,
    '',
    meeting.summary.trim() !== '' ? escapeMrkdwn(meeting.summary) : '전사만 저장됨'
  ]

  for (const s of meeting.sections) {
    const rendered = sectionLines(s, members)
    if (rendered.length > 0) lines.push('', ...rendered)
  }

  return lines.join('\n')
}

// chat.postMessage 요청 body를 만드는 순수 함수. 부수효과(네트워크)는 postChatMessage가 담당한다.
// members는 담당자 멘션 치환용이며, 비우면 기존처럼 전부 평문으로 나간다.
//
// 참석자 스코핑을 여기서 한다 — 호출부(자동 발송·수동 공유)가 각자 좁히게 두면 한쪽이 빠져도
// 타입 오류 없이 조용히 평문으로 나간다(실제로 그렇게 누락된 적이 있다). 워크스페이스 전체
// 목록을 그대로 넘겨도 이 함수가 회의 참석자로 좁히므로 모든 경로가 같은 결과를 낸다.
export function buildPostMessageBody(
  meeting: Meeting,
  channel: string,
  members: SlackMember[] = []
): { channel: string; text: string } {
  return { channel, text: buildMeetingText(meeting, membersInMeeting(meeting.participants, members)) }
}

// Slack Web API(chat.postMessage)에 POST한다. fetch를 주입받아 순수 로직과 분리된 TDD를 허용한다.
// 주의: Slack Web API는 실패도 HTTP 200으로 응답한다 — 반드시 응답 JSON의 ok 필드를 확인해야 한다.
export async function postChatMessage(
  token: string,
  body: { channel: string; text: string },
  fetchImpl: typeof fetch,
  timeoutMs = 10_000
): Promise<void> {
  const res = await fetchWithTimeout(
    fetchImpl,
    'https://slack.com/api/chat.postMessage',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(body)
    },
    timeoutMs
  )
  if (!res.ok) {
    throw new Error(`Slack API 응답 실패: ${res.status}`)
  }
  const json = (await res.json()) as { ok: boolean; error?: string }
  if (!json.ok) {
    throw new Error('slack: ' + (json.error ?? 'unknown_error'))
  }
}

export interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
}

// GET users.conversations — "봇이 실제 참여 중인" 공개·비공개 채널만 가져온다(exclude_archived).
// conversations.list(전체 공개 채널 조회 후 자동 join)에서 전환(v0.4.4) — 미참여 채널에 회의록이
// 올라가는 휴먼에러를 원천 차단하기 위해, 사용자가 먼저 채널에 봇을 초대해야만 목록에 뜨게 한다.
// users.conversations는 정의상 봇이 멤버인 채널만 반환하므로 isMember 필드가 불필요하다.
// 1회 최대 200개, cursor 페이징으로 최대 3페이지(600개)까지만 따라간다 — 그 이상은 검색 입력으로
// 좁히도록 유도한다.
export async function listChannels(
  token: string,
  fetchImpl: typeof fetch,
  timeoutMs = 10_000
): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = []
  let cursor: string | undefined
  const MAX_PAGES = 3

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL('https://slack.com/api/users.conversations')
    url.searchParams.set('types', 'public_channel,private_channel')
    url.searchParams.set('exclude_archived', 'true')
    url.searchParams.set('limit', '200')
    if (cursor) url.searchParams.set('cursor', cursor)

    const res = await fetchWithTimeout(
      fetchImpl,
      url.toString(),
      { headers: { Authorization: `Bearer ${token}` } },
      timeoutMs
    )
    if (!res.ok) throw new Error(`Slack API 응답 실패: ${res.status}`)
    const json = (await res.json()) as {
      ok: boolean
      error?: string
      channels?: Array<{ id: string; name: string; is_private: boolean }>
      response_metadata?: { next_cursor?: string }
    }
    if (!json.ok) throw new Error('slack: ' + (json.error ?? 'unknown_error'))

    for (const c of json.channels ?? []) {
      channels.push({ id: c.id, name: c.name, isPrivate: c.is_private })
    }

    cursor = json.response_metadata?.next_cursor
    if (!cursor) break
  }

  return channels
}

// GET users.list — 워크스페이스 멤버 전체를 가져와 회의 참석자 후보로 쓴다(users:read 필요).
// listChannels와 같은 cursor 페이징 관례를 따르되, 멤버 수는 채널보다 많을 수 있어 상한을
// 10페이지로 둔다. 알려진 한계: 그 이상(원시 2000명 초과)이면 뒷부분이 조용히 잘리고 현재
// 사용자에게 알리는 경로가 없다 — 잘린 구간의 멤버는 참석자 후보에도, 멘션에도 나타나지 않는다.
// 참고로 응답에는 봇·삭제 계정이 대부분이므로 원시 2000명이 실제 사람 2000명을 뜻하지 않는다.
export async function listUsers(
  token: string,
  fetchImpl: typeof fetch,
  timeoutMs = 15_000
): Promise<SlackMember[]> {
  const raw: SlackApiUser[] = []
  let cursor: string | undefined
  const MAX_PAGES = 10

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL('https://slack.com/api/users.list')
    url.searchParams.set('limit', '200')
    if (cursor) url.searchParams.set('cursor', cursor)

    const res = await fetchWithTimeout(
      fetchImpl,
      url.toString(),
      { headers: { Authorization: `Bearer ${token}` } },
      timeoutMs
    )
    if (!res.ok) throw new Error(`Slack API 응답 실패: ${res.status}`)
    const json = (await res.json()) as {
      ok: boolean
      error?: string
      members?: SlackApiUser[]
      response_metadata?: { next_cursor?: string }
    }
    if (!json.ok) throw new Error('slack: ' + (json.error ?? 'unknown_error'))

    raw.push(...(json.members ?? []))

    cursor = json.response_metadata?.next_cursor
    if (!cursor) break
  }

  return toSlackMembers(raw)
}

type SendSlackNotificationDeps = {
  buildBody: typeof buildPostMessageBody
  post: typeof postChatMessage
  fetchImpl: typeof fetch
  log: (...args: unknown[]) => void
  notifyFailure?: (failure: SlackSendFailure) => void
}

const defaultDeps: SendSlackNotificationDeps = {
  buildBody: buildPostMessageBody,
  post: postChatMessage,
  fetchImpl: fetch,
  log: console.error
}

// 봇 미초대는 실패 사유 중 사용자가 직접 고칠 수 있는 유일한 케이스다.
function withInviteHint(message: string): string {
  return message.includes('not_in_channel') ? `${message} — 채널에 Minit 봇을 초대하세요` : message
}

// pipeline:run 후처리 진입점. 회의록 저장 성공 이후 "덤"으로 붙는 부가 기능이므로 어떤 이유로도
// 절대 throw하지 않는다(payload 생성 동기 예외·발송 비동기 실패 모두 이 함수 내부에서 흡수).
// deps를 주입 가능하게 해 통합 테스트에서 두 실패 경로를 모두 검증한다.
// 봇 토큰 원문은 로그에 남기지 않는다(에러 메시지만 남긴다).
export function sendSlackNotification(
  meeting: Meeting,
  token: string | null,
  channel: string | null,
  deps: SendSlackNotificationDeps = defaultDeps,
  members: SlackMember[] = []
): void {
  if (!token || !channel) return
  // 요약이 없으면(전사만 저장된 상태) 발송을 건너뛴다 — 요약 생성 이후에만 Slack에 올라가야 한다.
  if (meeting.summary.trim() === '') return

  // 실패는 삼키되(파이프라인 무영향) 사용자에게는 알린다 — 조용히 실패하면 사용자는 회의록이
  // 공유된 줄 안다. 재시도는 하지 않는다(회의록 상세의 공유 모달로 직접 다시 보낼 수 있다).
  const reportFailure = (reason: string): void => {
    deps.notifyFailure?.({ title: meeting.title, reason })
  }

  try {
    const body = deps.buildBody(meeting, channel, members)
    void deps.post(token, body, deps.fetchImpl).catch((e) => {
      const message = withInviteHint(e instanceof Error ? e.message : String(e))
      deps.log('[slack] 회의 요약 발송 실패:', message)
      reportFailure(message)
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    deps.log('[slack] payload 생성 실패:', message)
    reportFailure(message)
  }
}

// 채널 설정·토큰 로딩까지 묶은 발송 진입점. pipeline:run(최초 저장)과 summary:regenerate(재생성)
// 양쪽 모두 "회의가 저장/갱신된 직후"라는 동일한 트리거에서 호출하므로 공용화한다.
// loadToken은 ipc.ts에서 configDir·safeStorage를 캡처한 클로저로 주입된다.
export function notifySlackForMeeting(
  meeting: Meeting,
  channelId: string | null | undefined,
  loadToken: () => string | null,
  notifyFailure?: (failure: SlackSendFailure) => void,
  send: typeof sendSlackNotification = sendSlackNotification,
  members: SlackMember[] = []
): void {
  if (!channelId) return
  const token = loadToken()
  // 워크스페이스 전체 목록을 그대로 넘긴다 — 참석자 스코핑은 buildPostMessageBody가 한다.
  if (token) send(meeting, token, channelId, { ...defaultDeps, notifyFailure }, members)
}

// 설정이 정하는 유효 기본 발송 채널 — 자동 발송(slackAutoSend)이 꺼져 있으면 기본 알림
// 채널이 선택돼 있어도 자동 발송하지 않는다(null). 채널 자체는 회의 시작 override·공유
// 모달의 후보로 계속 쓰이므로, 발송 여부 판단은 채널 저장값이 아니라 이 함수를 거친다.
export function defaultSlackChannelId(settings: {
  slackChannelId: string | null
  slackAutoSend: boolean
}): string | null {
  return settings.slackAutoSend ? settings.slackChannelId : null
}

// 회의별 채널 override(3-상태)를 설정 기본값과 합쳐 최종 발송 채널을 정한다.
// undefined = override 안 함(기본값 사용) / null = 이번 회의 발송 안 함 / string = 이 채널로.
export function resolveSlackChannelId(
  override: string | null | undefined,
  fallback: string | null
): string | null {
  return override !== undefined ? override : fallback
}
