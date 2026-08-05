import { describe, expect, test, vi } from 'vitest'
import {
  deleteSlackMembers,
  loadSlackMembers,
  saveSlackMembers,
  slackMembersFile,
  syncSlackMembers,
  type SyncSlackMembersDeps
} from '../../src/main/slack-members-store'
import type { SlackMembers } from '../../src/shared/types'

const DIR = '/tmp/minit-test'
const noop = (): void => {}

describe('slackMembersFile', () => {
  test('configDir 하위 slack-members.json 경로를 만든다', () => {
    expect(slackMembersFile(DIR)).toBe('/tmp/minit-test/slack-members.json')
  })
})

describe('loadSlackMembers', () => {
  test('파일이 없으면 빈 목록을 반환한다', () => {
    const result = loadSlackMembers(DIR, () => false, () => '', noop)
    expect(result).toEqual({ members: [], syncedAt: null, lastError: null })
  })

  test('저장된 목록을 읽어온다', () => {
    const raw = JSON.stringify({
      members: [{ id: 'U001', name: 'Ivy(김하나)' }],
      syncedAt: '2026-08-04T08:27:00.000Z'
    })
    const result = loadSlackMembers(DIR, () => true, () => raw, noop)
    expect(result.members).toHaveLength(1)
    expect(result.syncedAt).toBe('2026-08-04T08:27:00.000Z')
  })

  test('저장된 lastError를 함께 읽어온다 — 기동 시 실패 사유가 설정 화면까지 살아남아야 한다', () => {
    const raw = JSON.stringify({
      members: [],
      syncedAt: null,
      lastError: { reason: 'missing_scope', detail: 'slack: missing_scope' }
    })
    expect(loadSlackMembers(DIR, () => true, () => raw, noop).lastError).toEqual({
      reason: 'missing_scope',
      detail: 'slack: missing_scope'
    })
  })

  test('손상된 JSON이면 빈 목록으로 폴백하고 로그를 남긴다', () => {
    const log = vi.fn()
    expect(loadSlackMembers(DIR, () => true, () => '{ 깨진', log)).toEqual({
      members: [],
      syncedAt: null,
      lastError: null
    })
    expect(log).toHaveBeenCalledTimes(1)
  })

  test('형태가 어긋나면 빈 목록으로 폴백한다', () => {
    const result = loadSlackMembers(DIR, () => true, () => '{"members":"nope"}', noop)
    expect(result.members).toEqual([])
  })

  test('읽기 자체가 실패해도 빈 목록으로 폴백하고 로그를 남긴다', () => {
    const log = vi.fn()
    const result = loadSlackMembers(DIR, () => true, () => {
      throw new Error('EACCES')
    }, log)
    expect(result.members).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
  })

  test('존재 확인이 던져도 흡수한다 — 디렉터리 권한 문제가 앱을 막으면 안 된다', () => {
    const log = vi.fn()
    const result = loadSlackMembers(DIR, () => {
      throw new Error('EACCES')
    }, () => '', log)
    expect(result.members).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
  })
})

describe('saveSlackMembers', () => {
  test('payload를 그대로 파일에 쓴다', () => {
    const writeFile = vi.fn()
    const payload: SlackMembers = {
      members: [{ id: 'U001', name: 'Ivy(김하나)' }],
      syncedAt: '2026-08-04T08:27:00.000Z',
      lastError: null
    }
    const result = saveSlackMembers(DIR, payload, writeFile)

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [p, content] = writeFile.mock.calls[0]
    expect(p).toBe('/tmp/minit-test/slack-members.json')
    expect(JSON.parse(content).members[0].id).toBe('U001')
    expect(result).toEqual(payload)
  })
})

describe('deleteSlackMembers', () => {
  test('파일 경로로 삭제를 호출한다', () => {
    const rm = vi.fn()
    deleteSlackMembers(DIR, rm)
    expect(rm).toHaveBeenCalledWith('/tmp/minit-test/slack-members.json')
  })
})

describe('syncSlackMembers', () => {
  const stored: SlackMembers = {
    members: [{ id: 'U001', name: 'Ivy(김하나)' }],
    syncedAt: '2026-08-01T00:00:00.000Z',
    lastError: null
  }

  function deps(over: Partial<SyncSlackMembersDeps> = {}): SyncSlackMembersDeps {
    return {
      loadStored: () => stored,
      loadToken: () => 'xoxb-token',
      fetchMembers: async () => [{ id: 'U002', name: 'Max(이두리)' }],
      save: (payload) => payload,
      now: () => '2026-08-05T10:00:00.000Z',
      log: noop,
      ...over
    }
  }

  test('성공하면 새 목록과 syncedAt으로 교체하고 lastError를 지운다', async () => {
    const save = vi.fn((p: SlackMembers) => p)
    const result = await syncSlackMembers(deps({ save }))

    expect(result.members).toEqual([{ id: 'U002', name: 'Max(이두리)' }])
    expect(result.syncedAt).toBe('2026-08-05T10:00:00.000Z')
    expect(result.lastError).toBeNull()
    expect(save).toHaveBeenCalledTimes(1)
  })

  test('실패해도 기존 목록을 유지한다 — 오프라인에서 회의 시작이 막히면 안 된다', async () => {
    const result = await syncSlackMembers(
      deps({
        fetchMembers: async () => {
          throw new Error('slack: missing_scope')
        }
      })
    )

    expect(result.members).toEqual(stored.members)
    expect(result.syncedAt).toBe(stored.syncedAt)
  })

  test('실패 사유를 분류해 저장한다 — 나중에 설정 화면이 원인을 보여줄 수 있어야 한다', async () => {
    const save = vi.fn((p: SlackMembers) => p)
    const result = await syncSlackMembers(
      deps({
        save,
        fetchMembers: async () => {
          throw new Error('slack: missing_scope')
        }
      })
    )

    expect(result.lastError).toEqual({ reason: 'missing_scope', detail: 'slack: missing_scope' })
    expect(save).toHaveBeenCalledTimes(1) // 실패도 저장한다(사유 영속화)
  })

  test('네트워크 오류는 network로 분류한다', async () => {
    const result = await syncSlackMembers(
      deps({
        fetchMembers: async () => {
          throw new Error('Slack API 응답 실패: 503')
        }
      })
    )
    expect(result.lastError?.reason).toBe('network')
  })

  test('토큰이 없으면 조회하지 않고 no_token을 남긴다', async () => {
    const fetchMembers = vi.fn()
    const result = await syncSlackMembers(deps({ loadToken: () => null, fetchMembers }))

    expect(fetchMembers).not.toHaveBeenCalled()
    expect(result.lastError?.reason).toBe('no_token')
    expect(result.members).toEqual(stored.members)
  })

  test('실패 시에도 저장된 목록을 빈 배열로 덮어쓰지 않는다', async () => {
    const save = vi.fn((p: SlackMembers) => p)
    await syncSlackMembers(
      deps({
        save,
        fetchMembers: async () => {
          throw new Error('boom')
        }
      })
    )
    expect(save.mock.calls[0][0].members).toEqual(stored.members)
  })
})
