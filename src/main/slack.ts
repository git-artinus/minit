import { fetchWithTimeout } from '../shared/fetch-timeout'
import type { Meeting } from '../shared/types'

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

function actionItemLine(item: Meeting['actionItems'][number]): string {
  let line = `- [ ] ${escapeMrkdwn(item.text)}`
  if (item.assignee) line += ` (담당: ${escapeMrkdwn(item.assignee)})`
  if (item.due) line += ` (기한: ${escapeMrkdwn(item.due)})`
  return line
}

function buildMeetingText(meeting: Meeting): string {
  const participants =
    meeting.participants.length > 0 ? meeting.participants.map(escapeMrkdwn).join(', ') : '참석자 없음'
  const lines = [
    `*${escapeMrkdwn(meeting.title)}*`,
    `${formatMeetingDate(meeting.date)} · ${participants}`,
    '',
    meeting.summary.trim() !== '' ? escapeMrkdwn(meeting.summary) : '전사만 저장됨'
  ]

  if (meeting.actionItems.length > 0) {
    lines.push('', '*액션아이템*', ...meeting.actionItems.map(actionItemLine))
  }

  return lines.join('\n')
}

// chat.postMessage 요청 body를 만드는 순수 함수. 부수효과(네트워크)는 postChatMessage가 담당한다.
export function buildPostMessageBody(meeting: Meeting, channel: string): { channel: string; text: string } {
  return { channel, text: buildMeetingText(meeting) }
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

type SendSlackNotificationDeps = {
  buildBody: typeof buildPostMessageBody
  post: typeof postChatMessage
  fetchImpl: typeof fetch
  log: (...args: unknown[]) => void
}

const defaultDeps: SendSlackNotificationDeps = {
  buildBody: buildPostMessageBody,
  post: postChatMessage,
  fetchImpl: fetch,
  log: console.error
}

// pipeline:run 후처리 진입점. 회의록 저장 성공 이후 "덤"으로 붙는 부가 기능이므로 어떤 이유로도
// 절대 throw하지 않는다(payload 생성 동기 예외·발송 비동기 실패 모두 이 함수 내부에서 흡수).
// deps를 주입 가능하게 해 통합 테스트에서 두 실패 경로를 모두 검증한다.
// 봇 토큰 원문은 로그에 남기지 않는다(에러 메시지만 남긴다).
export function sendSlackNotification(
  meeting: Meeting,
  token: string | null,
  channel: string | null,
  deps: SendSlackNotificationDeps = defaultDeps
): void {
  if (!token || !channel) return
  // 요약이 없으면(전사만 저장된 상태) 발송을 건너뛴다 — 요약 생성 이후에만 Slack에 올라가야 한다.
  if (meeting.summary.trim() === '') return

  try {
    const body = deps.buildBody(meeting, channel)
    void deps.post(token, body, deps.fetchImpl).catch((e) => {
      const message = e instanceof Error ? e.message : String(e)
      const hint = message.includes('not_in_channel') ? ' — 채널에 Minit 봇을 초대하세요' : ''
      deps.log('[slack] 회의 요약 발송 실패:', message + hint)
    })
  } catch (e) {
    deps.log('[slack] payload 생성 실패:', e instanceof Error ? e.message : e)
  }
}

// 채널 설정·토큰 로딩까지 묶은 발송 진입점. pipeline:run(최초 저장)과 summary:regenerate(재생성)
// 양쪽 모두 "회의가 저장/갱신된 직후"라는 동일한 트리거에서 호출하므로 공용화한다.
// loadToken은 ipc.ts에서 configDir·safeStorage를 캡처한 클로저로 주입된다.
export function notifySlackForMeeting(
  meeting: Meeting,
  channelId: string | null | undefined,
  loadToken: () => string | null,
  send: typeof sendSlackNotification = sendSlackNotification
): void {
  if (!channelId) return
  const token = loadToken()
  if (token) send(meeting, token, channelId)
}
