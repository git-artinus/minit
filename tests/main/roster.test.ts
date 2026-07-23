import { describe, expect, test, vi } from 'vitest'
import { addParticipants, loadRoster, saveRoster, seedRosterIfMissing } from '../../src/main/roster'

const validJson = JSON.stringify({ participants: ['Hank', 'Joel'] })

describe('loadRoster', () => {
  test('~/.minit/participants.json이 있고 유효하면 Roster를 반환한다', () => {
    const result = loadRoster(
      '/home/user/.minit',
      (p) => p === '/home/user/.minit/participants.json',
      () => validJson
    )
    expect(result).toEqual({ participants: ['Hank', 'Joel'] })
  })

  test('participants.json이 없으면 null', () => {
    const result = loadRoster(
      '/home/user/.minit',
      () => false,
      () => {
        throw new Error('읽으면 안 된다')
      }
    )
    expect(result).toBeNull()
  })

  test('파싱 실패(형태 불일치)면 null', () => {
    const result = loadRoster(
      '/home/user/.minit',
      () => true,
      () => JSON.stringify({ participants: 'not-an-array' })
    )
    expect(result).toBeNull()
  })

  test('JSON 문법이 깨졌으면 null', () => {
    const result = loadRoster(
      '/home/user/.minit',
      () => true,
      () => '{oops'
    )
    expect(result).toBeNull()
  })
})

describe('saveRoster', () => {
  test('participants.json 경로에 JSON을 쓴다', () => {
    const writeFile = vi.fn()
    saveRoster('/home/user/.minit', { participants: ['Joel'] }, writeFile)
    expect(writeFile).toHaveBeenCalledWith(
      '/home/user/.minit/participants.json',
      JSON.stringify({ participants: ['Joel'] }, null, 2)
    )
  })
})

describe('seedRosterIfMissing', () => {
  test('파일이 이미 있으면 시드하지 않고 기존 로스터를 반환한다', () => {
    const writeFile = vi.fn()
    const result = seedRosterIfMissing('/home/user/.minit', {
      fileExists: () => true,
      readFile: () => validJson,
      writeFile,
      collectExistingParticipants: () => ['이건 호출되면 안 된다'],
    })
    expect(result).toEqual({ participants: ['Hank', 'Joel'] })
    expect(writeFile).not.toHaveBeenCalled()
  })

  test('파일이 없으면 기존 회의록 참석자로 시드하고 정렬·중복제거해 저장한다', () => {
    const writeFile = vi.fn()
    const result = seedRosterIfMissing('/home/user/.minit', {
      fileExists: () => false,
      readFile: () => {
        throw new Error('읽으면 안 된다')
      },
      writeFile,
      collectExistingParticipants: () => ['Hank', 'Joel', 'Hank'],
    })
    expect(result).toEqual({ participants: ['Hank', 'Joel'] })
    expect(writeFile).toHaveBeenCalledWith(
      '/home/user/.minit/participants.json',
      JSON.stringify({ participants: ['Hank', 'Joel'] }, null, 2)
    )
  })

  test('파일이 없고 기존 참석자도 없으면 빈 로스터로 시드한다', () => {
    const writeFile = vi.fn()
    const result = seedRosterIfMissing('/home/user/.minit', {
      fileExists: () => false,
      readFile: () => {
        throw new Error('읽으면 안 된다')
      },
      writeFile,
      collectExistingParticipants: () => [],
    })
    expect(result).toEqual({ participants: [] })
    expect(writeFile).toHaveBeenCalled()
  })
})

describe('addParticipants', () => {
  test('로스터에 없는 이름만 추가하고 정렬·저장한다', () => {
    const writeFile = vi.fn()
    const result = addParticipants(
      { participants: ['Hank'] },
      ['Joel', 'Hank'],
      writeFile,
      '/home/user/.minit'
    )
    expect(result).toEqual({ participants: ['Hank', 'Joel'] })
    expect(writeFile).toHaveBeenCalledWith(
      '/home/user/.minit/participants.json',
      JSON.stringify({ participants: ['Hank', 'Joel'] }, null, 2)
    )
  })

  test('대소문자 무시로 이미 있는 이름은 추가하지 않는다', () => {
    const writeFile = vi.fn()
    const result = addParticipants({ participants: ['Joel'] }, ['joel', 'JOEL'], writeFile, '/home/user/.minit')
    expect(result).toEqual({ participants: ['Joel'] })
    expect(writeFile).not.toHaveBeenCalled()
  })

  test('빈 문자열·공백만인 이름은 무시한다', () => {
    const writeFile = vi.fn()
    const result = addParticipants({ participants: ['Joel'] }, ['', '   '], writeFile, '/home/user/.minit')
    expect(result).toEqual({ participants: ['Joel'] })
    expect(writeFile).not.toHaveBeenCalled()
  })

  test('로스터가 null이면(파일 없음) 새로 만들어 저장한다', () => {
    const writeFile = vi.fn()
    const result = addParticipants(null, ['Joel'], writeFile, '/home/user/.minit')
    expect(result).toEqual({ participants: ['Joel'] })
    expect(writeFile).toHaveBeenCalledWith(
      '/home/user/.minit/participants.json',
      JSON.stringify({ participants: ['Joel'] }, null, 2)
    )
  })

  test('추가할 이름이 없으면 로스터가 null이어도 빈 로스터를 반환할 뿐 저장하지 않는다', () => {
    const writeFile = vi.fn()
    const result = addParticipants(null, [], writeFile, '/home/user/.minit')
    expect(result).toEqual({ participants: [] })
    expect(writeFile).not.toHaveBeenCalled()
  })

  test('배치 내 대소문자 변형은 1개만 등록(첫 표기 승리)', () => {
    const writeFile = vi.fn()
    const result = addParticipants(
      { participants: ['Hank'] },
      ['Joel', 'joel'],
      writeFile,
      '/home/user/.minit'
    )
    expect(result.participants).toHaveLength(2)
    expect(result.participants).toContain('Hank')
    expect(result.participants).toEqual(['Hank', 'Joel'])
    expect(writeFile).toHaveBeenCalledOnce()
  })

  test('배치 내 중복된 대소문자 변형으로 시드할 때도 1개만 등록', () => {
    const writeFile = vi.fn()
    const result = seedRosterIfMissing('/home/user/.minit', {
      fileExists: () => false,
      readFile: () => {
        throw new Error('읽으면 안 된다')
      },
      writeFile,
      collectExistingParticipants: () => ['Joel', 'joel', 'JOEL'],
    })
    expect(result.participants).toHaveLength(1)
    expect(result.participants).toEqual(['Joel'])
    expect(writeFile).toHaveBeenCalledOnce()
  })
})
