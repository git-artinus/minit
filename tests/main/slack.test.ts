import { describe, expect, test, vi } from 'vitest'
import {
  buildPostMessageBody,
  escapeMrkdwn,
  listChannels,
  listUsers,
  notifySlackForMeeting,
  postChatMessage,
  defaultSlackChannelId,
  resolveSlackChannelId,
  sendSlackNotification
} from '../../src/main/slack'
import type { ActionItem, Meeting, SlackMember } from '../../src/shared/types'

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    filename: '2026-07-22-회의.md',
    meetingType: 'general',
    title: '주간 회의',
    date: '2026-07-22T10:00:00+09:00',
    durationMin: 30,
    participants: ['철수', '영희'],
    summary: '이번 주 진행 상황을 공유했다.',
    sections: [],
    segments: [],
    ...over
  }
}

function actionsSection(items: ActionItem[]): Meeting['sections'] {
  return [{ heading: '액션아이템', kind: 'actions', items }]
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response
}

describe('escapeMrkdwn', () => {
  test('&, <, > 를 이 순서로 이스케이프한다', () => {
    expect(escapeMrkdwn('R&D <A>')).toBe('R&amp;D &lt;A&gt;')
  })

  test('특수문자가 없으면 원문 그대로 반환한다', () => {
    expect(escapeMrkdwn('그냥 텍스트')).toBe('그냥 텍스트')
  })
})

describe('buildPostMessageBody', () => {
  test('channel·제목(굵게)·날짜·참석자·요약을 포함한다', () => {
    const body = buildPostMessageBody(meeting(), '#회의록', 'full')
    expect(body.channel).toBe('#회의록')
    expect(body.text).toContain('*주간 회의*')
    expect(body.text).toContain('2026-07-22')
    expect(body.text).toContain('철수, 영희')
    expect(body.text).toContain('이번 주 진행 상황을 공유했다.')
  })

  test('참석자가 없으면 참석자 없음 문구를 넣는다', () => {
    const body = buildPostMessageBody(meeting({ participants: [] }), '#회의록', 'full')
    expect(body.text).toContain('참석자 없음')
  })

  test('요약이 없으면 "전사만 저장됨" 문구를 넣는다', () => {
    const body = buildPostMessageBody(meeting({ summary: '' }), '#회의록', 'full')
    expect(body.text).toContain('전사만 저장됨')
  })

  test('액션아이템이 있으면 체크리스트(mrkdwn)로 넣는다', () => {
    const body = buildPostMessageBody(
      meeting({
        sections: actionsSection([
          { text: '문서 작성', assignee: '철수', due: '2026-07-25' },
          { text: '리뷰 요청' }
        ])
      }),
      '#회의록',
      'full'
    )
    expect(body.text).toContain('액션아이템')
    expect(body.text).toContain('- [ ] 문서 작성 (담당: 철수) (기한: 2026-07-25)')
    expect(body.text).toContain('- [ ] 리뷰 요청')
  })

  test('액션아이템이 비어 있으면 액션아이템 섹션을 생략한다', () => {
    const body = buildPostMessageBody(meeting({ sections: actionsSection([]) }), '#회의록', 'full')
    expect(body.text).not.toContain('액션아이템')
  })

  test('타입 label을 헤드라인에 병기하고, list 섹션을 불릿으로 넣는다', () => {
    const body = buildPostMessageBody(
      meeting({
        meetingType: 'daily',
        sections: [
          { heading: '진척', kind: 'list', items: ['A 완료'] },
          { heading: '블로커', kind: 'list', items: [] }
        ]
      }),
      '#회의록',
      'full'
    )
    expect(body.text).toContain('*주간 회의* · 데일리')
    expect(body.text).toContain('*진척*')
    expect(body.text).toContain('- A 완료')
    expect(body.text).not.toContain('블로커') // 빈 섹션 생략
  })

  test('사용자 유래 텍스트(제목·요약·참석자·액션아이템)에 mrkdwn 이스케이프를 적용한다', () => {
    const body = buildPostMessageBody(
      meeting({
        title: 'R&D <기획>',
        participants: ['A&B', '<C>'],
        summary: '<script> & 위험',
        sections: actionsSection([{ text: 'R&D <검토>', assignee: '<팀장>', due: '<2026-08-01>' }])
      }),
      '#회의록',
      'full'
    )
    expect(body.text).toContain('*R&amp;D &lt;기획&gt;*')
    expect(body.text).toContain('A&amp;B, &lt;C&gt;')
    expect(body.text).toContain('&lt;script&gt; &amp; 위험')
    expect(body.text).toContain('- [ ] R&amp;D &lt;검토&gt; (담당: &lt;팀장&gt;) (기한: &lt;2026-08-01&gt;)')
  })

  test('기존처럼 특수문자가 없는 픽스처는 이스케이프 없이 그대로 통과한다', () => {
    const body = buildPostMessageBody(meeting(), '#회의록', 'full')
    expect(body.text).toContain('*주간 회의*')
    expect(body.text).toContain('철수, 영희')
  })
})

describe('postChatMessage', () => {
  test('ok:true: 정상 반환', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch
    await expect(
      postChatMessage('xoxb-token', { channel: '#회의록', text: 'hi' }, fetchImpl)
    ).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer xoxb-token',
          'Content-Type': 'application/json; charset=utf-8'
        }),
        body: JSON.stringify({ channel: '#회의록', text: 'hi' })
      })
    )
  })

  test('HTTP 200이지만 ok:false(not_in_channel): throw', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, error: 'not_in_channel' })) as unknown as typeof fetch
    await expect(
      postChatMessage('xoxb-token', { channel: '#회의록', text: 'hi' }, fetchImpl)
    ).rejects.toThrow(/not_in_channel/)
  })

  test('HTTP 비2xx 응답: throw', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404)) as unknown as typeof fetch
    await expect(postChatMessage('xoxb-token', { channel: '#회의록', text: 'hi' }, fetchImpl)).rejects.toThrow(
      /404/
    )
  })

  test('타임아웃: timeoutMs 경과 시 AbortController로 취소하고 실패한다', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    ) as unknown as typeof fetch

    const promise = postChatMessage('xoxb-token', { channel: '#회의록', text: 'hi' }, fetchImpl, 10_000)
    const assertion = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    vi.useRealTimers()
  })
})

describe('listChannels', () => {
  test('공개+비공개 혼합 목록을 isPrivate 필드와 함께 반환한다(users.conversations — 봇이 참여한 채널만)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ok: true,
        channels: [
          { id: 'C1', name: '회의록', is_private: false },
          { id: 'C2', name: '비밀채널', is_private: true }
        ],
        response_metadata: { next_cursor: '' }
      })
    )
    const fetchImpl = fetchMock as unknown as typeof fetch

    const result = await listChannels('xoxb-token', fetchImpl)

    expect(result).toEqual([
      { id: 'C1', name: '회의록', isPrivate: false },
      { id: 'C2', name: '비밀채널', isPrivate: true }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /users\.conversations.*types=public_channel%2Cprivate_channel.*exclude_archived=true.*limit=200/
      ),
      expect.objectContaining({ headers: { Authorization: 'Bearer xoxb-token' } })
    )
  })

  test('next_cursor가 있으면 다음 페이지를 이어서 조회하고 합쳐서 반환한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          channels: [{ id: 'C1', name: '채널1', is_private: false }],
          response_metadata: { next_cursor: 'CURSOR1' }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          channels: [{ id: 'C2', name: '채널2', is_private: false }],
          response_metadata: { next_cursor: '' }
        })
      )
    const fetchImpl = fetchMock as unknown as typeof fetch

    const result = await listChannels('xoxb-token', fetchImpl)

    expect(result.map((c) => c.id)).toEqual(['C1', 'C2'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('cursor=CURSOR1'), expect.anything())
  })

  test('최대 3페이지까지만 따라간다', async () => {
    const page = (cursor: string): Response =>
      jsonResponse({
        ok: true,
        channels: [{ id: cursor || 'C0', name: 'x', is_private: false }],
        response_metadata: { next_cursor: 'NEXT' }
      })
    const fetchImpl = vi.fn(async () => page('NEXT')) as unknown as typeof fetch

    await listChannels('xoxb-token', fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  test('ok:false: throw', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, error: 'invalid_auth' })) as unknown as typeof fetch
    await expect(listChannels('xoxb-token', fetchImpl)).rejects.toThrow(/invalid_auth/)
  })

  test('HTTP 비2xx 응답: throw', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500)) as unknown as typeof fetch
    await expect(listChannels('xoxb-token', fetchImpl)).rejects.toThrow(/500/)
  })
})

describe('sendSlackNotification', () => {
  const token = 'xoxb-token'
  const channel = '#회의록'

  test('정상 경로: buildBody 결과로 post를 호출한다', async () => {
    const body = { channel, text: 'ok' }
    const buildBody = vi.fn(() => body)
    const post = vi.fn(async () => undefined)
    const log = vi.fn()

    sendSlackNotification(meeting(), token, channel, 'full', { buildBody, post, fetchImpl: fetch, log })
    await Promise.resolve()
    await Promise.resolve()

    expect(buildBody).toHaveBeenCalledWith(meeting(), channel, 'full', [])
    expect(post).toHaveBeenCalledWith(token, body, fetch)
    expect(log).not.toHaveBeenCalled()
  })

  test('token이 없으면 no-op(post를 호출하지 않는다)', () => {
    const buildBody = vi.fn()
    const post = vi.fn()
    const log = vi.fn()

    expect(() =>
      sendSlackNotification(meeting(), null, channel, 'full', { buildBody, post, fetchImpl: fetch, log })
    ).not.toThrow()
    expect(buildBody).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  test('channel이 없으면 no-op(post를 호출하지 않는다)', () => {
    const buildBody = vi.fn()
    const post = vi.fn()
    const log = vi.fn()

    expect(() =>
      sendSlackNotification(meeting(), token, null, 'full', { buildBody, post, fetchImpl: fetch, log })
    ).not.toThrow()
    expect(buildBody).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  test('요약이 비어 있으면(전사만 저장됨) no-op(post를 호출하지 않는다)', () => {
    const buildBody = vi.fn()
    const post = vi.fn()
    const log = vi.fn()

    expect(() =>
      sendSlackNotification(meeting({ summary: '' }), token, channel, 'full', { buildBody, post, fetchImpl: fetch, log })
    ).not.toThrow()
    expect(buildBody).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  test('요약이 공백 문자뿐이어도 no-op(post를 호출하지 않는다)', () => {
    const buildBody = vi.fn()
    const post = vi.fn()
    const log = vi.fn()

    sendSlackNotification(meeting({ summary: '   \n  ' }), token, channel, 'full', { buildBody, post, fetchImpl: fetch, log })
    expect(buildBody).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  // 회귀 방지: 트랜스크립트(segments) 텍스트는 payload에 포함되지 않아야 한다(현행 유지).
  test('payload에 트랜스크립트(segments) 텍스트를 포함하지 않는다', () => {
    const body = buildPostMessageBody(
      meeting({ segments: [{ startMs: 0, text: '이것은 전사 원문입니다' }] }),
      '#회의록',
      'full'
    )
    expect(body.text).not.toContain('이것은 전사 원문입니다')
  })

  test('buildBody가 동기 throw해도 함수 자체는 throw하지 않는다', () => {
    const buildBody = vi.fn(() => {
      throw new Error('payload 생성 실패')
    })
    const post = vi.fn(async () => undefined)
    const log = vi.fn()

    expect(() =>
      sendSlackNotification(meeting(), token, channel, 'full', { buildBody, post, fetchImpl: fetch, log })
    ).not.toThrow()
    expect(post).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    // 토큰 원문이 로그에 남지 않아야 한다.
    expect(log.mock.calls[0].join(' ')).not.toContain(token)
  })

  test('post가 reject해도 함수 자체는 throw하지 않는다(비동기 실패는 catch로 격리)', async () => {
    const buildBody = vi.fn(() => ({ channel, text: 'ok' }))
    const post = vi.fn(async () => {
      throw new Error('네트워크 오류')
    })
    const log = vi.fn()

    expect(() =>
      sendSlackNotification(meeting(), token, channel, 'full', { buildBody, post, fetchImpl: fetch, log })
    ).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0].join(' ')).not.toContain(token)
  })

  test('post가 not_in_channel로 reject하면 로그에 "채널에 Minit 봇을 초대하세요" 힌트를 포함한다', async () => {
    const buildBody = vi.fn(() => ({ channel, text: 'ok' }))
    const post = vi.fn(async () => {
      throw new Error('slack: not_in_channel')
    })
    const log = vi.fn()

    sendSlackNotification(meeting(), token, channel, 'full', { buildBody, post, fetchImpl: fetch, log })
    await Promise.resolve()
    await Promise.resolve()

    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0].join(' ')
    expect(logged).toContain('not_in_channel')
    expect(logged).toContain('채널에 Minit 봇을 초대하세요')
    expect(logged).not.toContain(token)
  })

  test('발송이 실패하면 회의 제목·사유로 notifyFailure를 호출한다', async () => {
    const buildBody = vi.fn(() => ({ channel, text: 'ok' }))
    const post = vi.fn(async () => {
      throw new Error('네트워크 오류')
    })
    const notifyFailure = vi.fn()

    sendSlackNotification(meeting(), token, channel, 'full', {
      buildBody, post, fetchImpl: fetch, log: vi.fn(), notifyFailure
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(notifyFailure).toHaveBeenCalledWith({ title: '주간 회의', reason: '네트워크 오류' })
  })

  test('not_in_channel이면 notifyFailure 사유에 봇 초대 안내를 붙인다', async () => {
    const buildBody = vi.fn(() => ({ channel, text: 'ok' }))
    const post = vi.fn(async () => {
      throw new Error('slack: not_in_channel')
    })
    const notifyFailure = vi.fn()

    sendSlackNotification(meeting(), token, channel, 'full', {
      buildBody, post, fetchImpl: fetch, log: vi.fn(), notifyFailure
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(notifyFailure.mock.calls[0][0].reason).toContain('채널에 Minit 봇을 초대하세요')
  })

  test('payload 생성이 동기 throw해도 notifyFailure를 호출한다', () => {
    const buildBody = vi.fn(() => {
      throw new Error('payload 생성 실패')
    })
    const notifyFailure = vi.fn()

    sendSlackNotification(meeting(), token, channel, 'full', {
      buildBody, post: vi.fn(), fetchImpl: fetch, log: vi.fn(), notifyFailure
    })

    expect(notifyFailure).toHaveBeenCalledWith({ title: '주간 회의', reason: 'payload 생성 실패' })
  })

  test('발송에 성공하면 notifyFailure를 호출하지 않는다', async () => {
    const notifyFailure = vi.fn()

    sendSlackNotification(meeting(), token, channel, 'full', {
      buildBody: vi.fn(() => ({ channel, text: 'ok' })),
      post: vi.fn(async () => undefined),
      fetchImpl: fetch,
      log: vi.fn(),
      notifyFailure
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(notifyFailure).not.toHaveBeenCalled()
  })
})

describe('notifySlackForMeeting', () => {
  const channel = '#회의록'

  test('channelId가 없으면 loadToken·send 모두 호출하지 않는다', () => {
    const loadToken = vi.fn(() => 'xoxb-token')
    const send = vi.fn()

    notifySlackForMeeting(meeting(), null, 'full', loadToken, undefined, send)

    expect(loadToken).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  test('channelId는 있지만 토큰이 없으면 send를 호출하지 않는다', () => {
    const loadToken = vi.fn(() => null)
    const send = vi.fn()

    notifySlackForMeeting(meeting(), channel, 'full', loadToken, undefined, send)

    expect(loadToken).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  test('channelId·토큰이 모두 있으면 send를 호출한다(pipeline:run·summary:regenerate 공용 경로)', () => {
    const loadToken = vi.fn(() => 'xoxb-token')
    const send = vi.fn()
    const m = meeting()

    notifySlackForMeeting(m, channel, 'full', loadToken, undefined, send)

    expect(send).toHaveBeenCalledWith(m, 'xoxb-token', channel, 'full', expect.anything(), [])
  })

  test('실패 알림 콜백을 발송 deps로 넘긴다', () => {
    const notifyFailure = vi.fn()
    const send = vi.fn()

    notifySlackForMeeting(meeting(), channel, 'full', () => 'xoxb-token', notifyFailure, send)

    expect(send.mock.calls[0][4].notifyFailure).toBe(notifyFailure)
  })
})

describe('resolveSlackChannelId', () => {
  test('override 미지정(undefined)이면 설정 기본값을 사용한다', () => {
    expect(resolveSlackChannelId(undefined, 'C_DEFAULT')).toBe('C_DEFAULT')
  })
  test('override가 채널 id면 그 채널로 재정의한다', () => {
    expect(resolveSlackChannelId('C_OVERRIDE', 'C_DEFAULT')).toBe('C_OVERRIDE')
  })
  test('override가 null이면 발송하지 않는다(null 반환)', () => {
    expect(resolveSlackChannelId(null, 'C_DEFAULT')).toBeNull()
  })
  test('override 미지정이고 기본값도 없으면 null', () => {
    expect(resolveSlackChannelId(undefined, null)).toBeNull()
  })
})

describe('defaultSlackChannelId', () => {
  test('자동 발송이 켜져 있으면 기본 알림 채널을 반환한다', () => {
    expect(defaultSlackChannelId({ slackChannelId: 'C_DEFAULT', slackAutoSend: true })).toBe('C_DEFAULT')
  })
  test('자동 발송이 꺼져 있으면 채널이 선택돼 있어도 null이다', () => {
    expect(defaultSlackChannelId({ slackChannelId: 'C_DEFAULT', slackAutoSend: false })).toBeNull()
  })
  test('채널이 없으면 자동 발송이 켜져 있어도 null이다', () => {
    expect(defaultSlackChannelId({ slackChannelId: null, slackAutoSend: true })).toBeNull()
  })

  // 회의별 override와의 합성 — 자동 발송이 꺼져 있어도 회의 시작에서 채널을 지정하면 발송된다.
  test('자동 발송 꺼짐 + 회의별 채널 지정이면 그 채널로 발송한다', () => {
    const fallback = defaultSlackChannelId({ slackChannelId: 'C_DEFAULT', slackAutoSend: false })
    expect(resolveSlackChannelId('C_OVERRIDE', fallback)).toBe('C_OVERRIDE')
  })
  test('자동 발송 꺼짐 + override 미지정이면 발송하지 않는다', () => {
    const fallback = defaultSlackChannelId({ slackChannelId: 'C_DEFAULT', slackAutoSend: false })
    expect(resolveSlackChannelId(undefined, fallback)).toBeNull()
  })
})

// 관측 지점을 "실제로 전송된 메시지 본문"으로 둔다 — deps.buildBody를 직접 호출해 단언하면
// 배선이 끊겨도 통과하고, 내부 구조를 바꾸는 리팩터링마다 깨진다.
describe('notifySlackForMeeting 멘션 대상 제한', () => {
  const channel = '#회의록'

  function sentText(m: Meeting, members?: SlackMember[]): string {
    const post = vi.fn(
      async (_token: string, _body: { channel: string; text: string }, _f: typeof fetch) => {}
    )
    notifySlackForMeeting(
      m,
      channel,
      'full',
      () => 'xoxb-token',
      undefined,
      // deps는 notifySlackForMeeting이 항상 채워 넘긴다(기본값이 있어 타입만 optional이다).
      (mt, token, ch, scope, deps, mem) =>
        sendSlackNotification(mt, token, ch, scope, { ...deps!, post }, mem),
      members
    )
    return post.mock.calls[0][1].text
  }

  test('참석자인 담당자를 멘션으로 보낸다', () => {
    const text = sentText(
      meeting({
        participants: ['Ivy(김하나)'],
        sections: actionsSection([{ text: 'API 확정', assignee: 'Ivy(김하나)' }])
      }),
      [
        { id: 'U001', name: 'Ivy(김하나)' },
        { id: 'U002', name: 'Max(이두리)' } // 참석자가 아니다
      ]
    )
    expect(text).toContain('<@U001>')
    expect(text).not.toContain('U002')
  })

  test('담당자가 참석자가 아니면 멘션하지 않는다', () => {
    const text = sentText(
      meeting({
        participants: ['Max(이두리)'],
        sections: actionsSection([{ text: '보고', assignee: 'Ivy(김하나)' }])
      }),
      [{ id: 'U001', name: 'Ivy(김하나)' }]
    )
    expect(text).toContain('(담당: Ivy(김하나))')
    expect(text).not.toContain('<@')
  })

  test('멤버를 넘기지 않으면 담당자가 모두 평문이다', () => {
    const text = sentText(
      meeting({
        participants: ['Ivy(김하나)'],
        sections: actionsSection([{ text: 'API 확정', assignee: 'Ivy(김하나)' }])
      })
    )
    expect(text).not.toContain('<@')
  })
})

describe('listUsers', () => {
  test('봇·삭제 계정을 거른 멤버 목록을 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        members: [
          { id: 'U001', name: 'ivy', profile: { display_name: 'Ivy(김하나)' } },
          { id: 'U002', name: 'bot', is_bot: true, profile: { display_name: 'Bot' } },
          { id: 'USLACKBOT', name: 'slackbot', profile: { display_name: 'Slackbot' } }
        ]
      })
    )
    const result = await listUsers('xoxb-t', fetchImpl as unknown as typeof fetch)
    expect(result).toEqual([{ id: 'U001', name: 'Ivy(김하나)' }])
  })

  test('cursor가 있으면 다음 페이지를 이어서 조회한다', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          members: [{ id: 'U001', profile: { display_name: 'A' } }],
          response_metadata: { next_cursor: 'c1' }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, members: [{ id: 'U002', profile: { display_name: 'B' } }] })
      )
    const result = await listUsers('xoxb-t', fetchImpl as unknown as typeof fetch)
    expect(result.map((m) => m.id)).toEqual(['U001', 'U002'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  test('limit=200으로 요청한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, members: [] }))
    await listUsers('xoxb-t', fetchImpl as unknown as typeof fetch)
    expect(String(fetchImpl.mock.calls[0][0])).toContain('limit=200')
  })

  test('ok:false면 에러 코드를 담아 throw한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: 'missing_scope' }))
    await expect(listUsers('xoxb-t', fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      'missing_scope'
    )
  })

  test('HTTP 실패면 상태 코드를 담아 throw한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500))
    await expect(listUsers('xoxb-t', fetchImpl as unknown as typeof fetch)).rejects.toThrow('500')
  })

  test('빈 cursor는 마지막 페이지로 본다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        members: [{ id: 'U001', profile: { display_name: 'A' } }],
        response_metadata: { next_cursor: '' }
      })
    )
    await listUsers('xoxb-t', fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('담당자 멘션', () => {
  const members: SlackMember[] = [
    { id: 'U001', name: 'Ivy(김하나)' },
    { id: 'U002', name: 'Max(이두리)' }
  ]
  // buildPostMessageBody가 참석자 스코핑까지 하므로 픽스처에 참석자를 명시해야 멘션이 나온다.
  const attended = (over: Partial<Meeting> = {}): Meeting =>
    meeting({ participants: ['Ivy(김하나)'], ...over })

  test('Slack 멤버와 완전 일치하는 담당자를 멘션으로 바꾼다', () => {
    const m = attended({ sections: actionsSection([{ text: 'API 확정', assignee: 'Ivy(김하나)' }]) })
    expect(buildPostMessageBody(m, '#회의록', 'full', members).text).toContain('(담당: <@U001>)')
  })

  test('멤버에 없는 담당자는 평문으로 남긴다', () => {
    const m = attended({ sections: actionsSection([{ text: '검토', assignee: '외부 자문위원' }]) })
    const body = buildPostMessageBody(m, '#회의록', 'full', members)
    expect(body.text).toContain('(담당: 외부 자문위원)')
    expect(body.text).not.toContain('<@')
  })

  test('멤버 목록을 넘기지 않으면 모두 평문이다(기존 동작 유지)', () => {
    const m = attended({ sections: actionsSection([{ text: 'API 확정', assignee: 'Ivy(김하나)' }]) })
    expect(buildPostMessageBody(m, '#회의록', 'full').text).toContain('(담당: Ivy(김하나))')
  })

  test('참석자가 아닌 사람은 멤버 목록에 있어도 멘션하지 않는다', () => {
    const m = meeting({
      participants: ['철수'],
      sections: actionsSection([{ text: '보고', assignee: 'Ivy(김하나)' }])
    })
    const body = buildPostMessageBody(m, '#회의록', 'full', members)
    expect(body.text).toContain('(담당: Ivy(김하나))')
    expect(body.text).not.toContain('<@')
  })

  test('멘션 토큰이 mrkdwn 이스케이프에 깨지지 않는다', () => {
    const m = attended({ sections: actionsSection([{ text: 'API 확정', assignee: 'Ivy(김하나)' }]) })
    const body = buildPostMessageBody(m, '#회의록', 'full', members)
    expect(body.text).not.toContain('&lt;@')
    expect(body.text).toMatch(/<@U001>/)
  })

  test('담당자 이름에 특수문자가 있어도 평문 폴백은 이스케이프된다', () => {
    const m = attended({ sections: actionsSection([{ text: '검토', assignee: 'R&D <팀>' }]) })
    const body = buildPostMessageBody(m, '#회의록', 'full', members)
    expect(body.text).toContain('(담당: R&amp;D &lt;팀&gt;)')
  })

  test('기한은 멘션 여부와 무관하게 그대로 붙는다', () => {
    const m = attended({
      sections: actionsSection([{ text: 'API 확정', assignee: 'Ivy(김하나)', due: '8/10' }])
    })
    const body = buildPostMessageBody(m, '#회의록', 'full', members)
    expect(body.text).toContain('(담당: <@U001>) (기한: 8/10)')
  })

  test('참석자 목록은 멘션하지 않는다', () => {
    const m = attended({ sections: [] })
    const body = buildPostMessageBody(m, '#회의록', 'full', members)
    expect(body.text).toContain('Ivy(김하나)')
    expect(body.text).not.toContain('<@U001>')
  })
})

function weeklySections(): Meeting['sections'] {
  return [
    { heading: '결정사항', kind: 'list', items: ['A로 간다', 'B는 보류'] },
    { heading: '진행 상황', kind: 'list', items: ['C 구현 80%'] },
    {
      heading: '다음 주 액션아이템',
      kind: 'actions',
      items: [{ text: 'D 배포', assignee: '조엘' }]
    }
  ]
}

describe('발송 범위(scope)', () => {
  test('summary — 섹션을 하나도 담지 않는다', () => {
    const text = buildPostMessageBody(meeting({ sections: weeklySections() }), 'C1', 'summary').text
    expect(text).toContain('이번 주 진행 상황을 공유했다.')
    expect(text).not.toContain('결정사항')
    expect(text).not.toContain('*진행 상황*')
    expect(text).not.toContain('다음 주 액션아이템')
  })

  test('actions — actions 섹션만 담는다', () => {
    const text = buildPostMessageBody(meeting({ sections: weeklySections() }), 'C1', 'actions').text
    expect(text).toContain('이번 주 진행 상황을 공유했다.')
    expect(text).toContain('다음 주 액션아이템')
    expect(text).toContain('D 배포')
    expect(text).not.toContain('A로 간다')
    expect(text).not.toContain('C 구현 80%')
  })

  test('full — 모든 섹션을 담는다', () => {
    const text = buildPostMessageBody(meeting({ sections: weeklySections() }), 'C1', 'full').text
    expect(text).toContain('A로 간다')
    expect(text).toContain('C 구현 80%')
    expect(text).toContain('D 배포')
  })

  // 아이디어·간이 타입은 actions 섹션이 없다. 이때 actions는 summary와 같아야 한다.
  test('actions 섹션이 없는 회의는 actions와 summary 결과가 같다', () => {
    const ideaSections: Meeting['sections'] = [
      { heading: '아이디어', kind: 'list', items: ['알림 개선'] },
      { heading: '후보 방향', kind: 'list', items: ['A안'] }
    ]
    const m = meeting({ meetingType: 'idea', sections: ideaSections })
    expect(buildPostMessageBody(m, 'C1', 'actions').text).toBe(
      buildPostMessageBody(m, 'C1', 'summary').text
    )
  })

  test('요약 문단의 빈 줄을 그대로 보낸다', () => {
    const m = meeting({ summary: '첫째 문단.\n\n둘째 문단.' })
    expect(buildPostMessageBody(m, 'C1', 'summary').text).toContain('첫째 문단.\n\n둘째 문단.')
  })
})
