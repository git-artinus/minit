import { describe, expect, test, vi } from 'vitest'
import {
  deleteSlackMembers,
  loadSlackMembers,
  saveSlackMembers,
  slackMembersFile
} from '../../src/main/slack-members-store'

const DIR = '/tmp/minit-test'

describe('slackMembersFile', () => {
  test('configDir 하위 slack-members.json 경로를 만든다', () => {
    expect(slackMembersFile(DIR)).toBe('/tmp/minit-test/slack-members.json')
  })
})

describe('loadSlackMembers', () => {
  test('파일이 없으면 빈 목록을 반환한다', () => {
    const result = loadSlackMembers(DIR, () => false, () => '')
    expect(result).toEqual({ members: [], syncedAt: '' })
  })

  test('저장된 목록을 읽어온다', () => {
    const raw = JSON.stringify({
      members: [{ id: 'U001', name: 'Ivy(김하나)' }],
      syncedAt: '2026-08-04T08:27:00.000Z'
    })
    const result = loadSlackMembers(DIR, () => true, () => raw)
    expect(result.members).toHaveLength(1)
    expect(result.syncedAt).toBe('2026-08-04T08:27:00.000Z')
  })

  test('손상된 JSON이면 빈 목록으로 폴백한다', () => {
    const result = loadSlackMembers(DIR, () => true, () => '{ 깨진')
    expect(result).toEqual({ members: [], syncedAt: '' })
  })

  test('형태가 어긋나면 빈 목록으로 폴백한다', () => {
    const result = loadSlackMembers(DIR, () => true, () => '{"members":"nope"}')
    expect(result).toEqual({ members: [], syncedAt: '' })
  })

  test('읽기 자체가 실패해도 빈 목록으로 폴백한다', () => {
    const result = loadSlackMembers(DIR, () => true, () => {
      throw new Error('EACCES')
    })
    expect(result).toEqual({ members: [], syncedAt: '' })
  })
})

describe('saveSlackMembers', () => {
  test('members와 syncedAt을 파일로 쓴다', () => {
    const writeFile = vi.fn()
    const result = saveSlackMembers(
      DIR,
      [{ id: 'U001', name: 'Ivy(김하나)' }],
      '2026-08-04T08:27:00.000Z',
      writeFile
    )

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [p, content] = writeFile.mock.calls[0]
    expect(p).toBe('/tmp/minit-test/slack-members.json')
    expect(JSON.parse(content).members[0].id).toBe('U001')
    expect(result.syncedAt).toBe('2026-08-04T08:27:00.000Z')
  })
})

describe('deleteSlackMembers', () => {
  test('파일 경로로 삭제를 호출한다', () => {
    const rm = vi.fn()
    deleteSlackMembers(DIR, rm)
    expect(rm).toHaveBeenCalledWith('/tmp/minit-test/slack-members.json')
  })
})
