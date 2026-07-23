import { describe, expect, test, vi } from 'vitest'
import {
  deleteToken,
  loadToken,
  migrateLegacySlackToken,
  saveToken,
  tokenFilePath
} from '../../src/main/slack-token-store'

function fakeSafeStorage(available = true): {
  isEncryptionAvailable: () => boolean
  encryptString: (s: string) => Buffer
  decryptString: (b: Buffer) => string
} {
  return {
    isEncryptionAvailable: () => available,
    // 테스트용 단순 리버서블 인코딩(실제 암호화는 Electron safeStorage가 담당 — 여기선 주입 경계만 검증)
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8').replace(/^enc:/, '')
  }
}

function fakeFs(): {
  files: Map<string, Buffer>
  existsSync: (p: string) => boolean
  writeFileSync: (p: string, data: Buffer) => void
  readFileSync: (p: string) => Buffer
  rmSync: (p: string) => void
  mkdirSync: () => void
} {
  const files = new Map<string, Buffer>()
  return {
    files,
    existsSync: (p: string) => files.has(p),
    writeFileSync: (p: string, data: Buffer) => {
      files.set(p, data)
    },
    readFileSync: (p: string) => {
      const v = files.get(p)
      if (!v) throw new Error('ENOENT')
      return v
    },
    rmSync: (p: string) => {
      files.delete(p)
    },
    mkdirSync: () => undefined
  }
}

describe('tokenFilePath', () => {
  test('minitHome 하위 slack-token.enc 경로를 반환한다', () => {
    expect(tokenFilePath('/home/.minit')).toBe('/home/.minit/slack-token.enc')
  })
})

describe('saveToken → loadToken 왕복', () => {
  test('저장 후 그대로 복호화되어 돌아온다', () => {
    const fs = fakeFs()
    const safeStorage = fakeSafeStorage()
    saveToken('/home/.minit', 'xoxb-secret', { fs, safeStorage })
    expect(loadToken('/home/.minit', { fs, safeStorage })).toBe('xoxb-secret')
  })

  test('평문으로 저장하지 않는다(디스크에는 암호화된 바이트만 남는다)', () => {
    const fs = fakeFs()
    const safeStorage = fakeSafeStorage()
    saveToken('/home/.minit', 'xoxb-secret', { fs, safeStorage })
    const raw = fs.files.get(tokenFilePath('/home/.minit'))!.toString('utf-8')
    expect(raw).not.toBe('xoxb-secret')
  })
})

describe('safeStorage 미가용', () => {
  test('저장 시 평문 저장을 거부하고 오류를 던진다', () => {
    const fs = fakeFs()
    const safeStorage = fakeSafeStorage(false)
    expect(() => saveToken('/home/.minit', 'xoxb-secret', { fs, safeStorage })).toThrow()
    expect(fs.files.size).toBe(0)
  })
})

describe('deleteToken', () => {
  test('토큰 파일을 삭제한다(없어도 오류 없음)', () => {
    const fs = fakeFs()
    const safeStorage = fakeSafeStorage()
    saveToken('/home/.minit', 'xoxb-secret', { fs, safeStorage })
    deleteToken('/home/.minit', { fs })
    expect(loadToken('/home/.minit', { fs, safeStorage })).toBeNull()
    expect(() => deleteToken('/home/.minit', { fs })).not.toThrow()
  })
})

describe('migrateLegacySlackToken', () => {
  test('평문 slackBotToken이 있으면 암호화 저장소로 옮기고 settings.json에서 제거한다(slackChannel도 폐기)', () => {
    const tokenFs = fakeFs()
    const safeStorage = fakeSafeStorage()
    const settingsFiles = new Map<string, string>()
    settingsFiles.set(
      '/home/.minit/settings.json',
      JSON.stringify({ repoRoot: '/r', slackBotToken: 'xoxb-legacy', slackChannel: '#회의록' })
    )

    migrateLegacySlackToken('/home/.minit', {
      tokenStoreFs: tokenFs,
      safeStorage,
      readSettingsFile: (p) => settingsFiles.get(p) ?? null,
      writeSettingsFile: (p, content) => settingsFiles.set(p, content)
    })

    expect(loadToken('/home/.minit', { fs: tokenFs, safeStorage })).toBe('xoxb-legacy')
    const rewritten = JSON.parse(settingsFiles.get('/home/.minit/settings.json')!)
    expect(rewritten.slackBotToken).toBeUndefined()
    expect(rewritten.slackChannel).toBeUndefined()
    expect(rewritten.repoRoot).toBe('/r') // 다른 필드는 그대로 보존
  })

  test('slackBotToken이 없으면 아무 일도 하지 않는다', () => {
    const tokenFs = fakeFs()
    const safeStorage = fakeSafeStorage()
    const settingsFiles = new Map<string, string>()
    const original = JSON.stringify({ repoRoot: '/r' })
    settingsFiles.set('/home/.minit/settings.json', original)

    migrateLegacySlackToken('/home/.minit', {
      tokenStoreFs: tokenFs,
      safeStorage,
      readSettingsFile: (p) => settingsFiles.get(p) ?? null,
      writeSettingsFile: (p, content) => settingsFiles.set(p, content)
    })

    expect(settingsFiles.get('/home/.minit/settings.json')).toBe(original)
    expect(tokenFs.files.size).toBe(0)
  })

  test('settings.json이 없으면 아무 일도 하지 않는다', () => {
    const tokenFs = fakeFs()
    const safeStorage = fakeSafeStorage()
    expect(() =>
      migrateLegacySlackToken('/home/.minit', {
        tokenStoreFs: tokenFs,
        safeStorage,
        readSettingsFile: () => null,
        writeSettingsFile: () => {
          throw new Error('호출되면 안 됨')
        }
      })
    ).not.toThrow()
  })

  test('safeStorage 미가용 등 암호화 저장 실패 시 settings.json을 건드리지 않는다(평문 유지, 다음 로드 때 재시도)', () => {
    const tokenFs = fakeFs()
    const safeStorage = fakeSafeStorage(false)
    const settingsFiles = new Map<string, string>()
    const original = JSON.stringify({ repoRoot: '/r', slackBotToken: 'xoxb-legacy' })
    settingsFiles.set('/home/.minit/settings.json', original)

    migrateLegacySlackToken('/home/.minit', {
      tokenStoreFs: tokenFs,
      safeStorage,
      readSettingsFile: (p) => settingsFiles.get(p) ?? null,
      writeSettingsFile: (p, content) => settingsFiles.set(p, content)
    })

    expect(settingsFiles.get('/home/.minit/settings.json')).toBe(original)
  })

  test('safeStorage 미가용 등 암호화 저장 실패가 지속되면 경고 로그를 남기되 토큰 원문은 포함하지 않는다', () => {
    const tokenFs = fakeFs()
    const safeStorage = fakeSafeStorage(false)
    const settingsFiles = new Map<string, string>()
    settingsFiles.set(
      '/home/.minit/settings.json',
      JSON.stringify({ repoRoot: '/r', slackBotToken: 'xoxb-secret-must-not-be-logged' })
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      migrateLegacySlackToken('/home/.minit', {
        tokenStoreFs: tokenFs,
        safeStorage,
        readSettingsFile: (p) => settingsFiles.get(p) ?? null,
        writeSettingsFile: (p, content) => settingsFiles.set(p, content)
      })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const loggedArgs = warnSpy.mock.calls[0].map((a) => String(a)).join(' ')
      expect(loggedArgs).not.toContain('xoxb-secret-must-not-be-logged')
    } finally {
      warnSpy.mockRestore()
    }
  })

  test('safeStorage 불가→가용 전환 후 재시도하면 이관에 성공한다(리뷰 Fix 1)', () => {
    const tokenFs = fakeFs()
    const settingsFiles = new Map<string, string>()
    settingsFiles.set(
      '/home/.minit/settings.json',
      JSON.stringify({ repoRoot: '/r', slackBotToken: 'xoxb-legacy' })
    )
    const deps = {
      tokenStoreFs: tokenFs,
      readSettingsFile: (p: string) => settingsFiles.get(p) ?? null,
      writeSettingsFile: (p: string, content: string) => settingsFiles.set(p, content)
    }

    // 1차 시도 — safeStorage 미가용, 평문은 그대로 보존된다
    migrateLegacySlackToken('/home/.minit', { ...deps, safeStorage: fakeSafeStorage(false) })
    expect(JSON.parse(settingsFiles.get('/home/.minit/settings.json')!).slackBotToken).toBe('xoxb-legacy')
    expect(tokenFs.files.size).toBe(0)

    // safeStorage가 가용해진 뒤 재시도(예: settings:update 훅) — 이번엔 성공한다
    const safeStorageNowAvailable = fakeSafeStorage(true)
    migrateLegacySlackToken('/home/.minit', { ...deps, safeStorage: safeStorageNowAvailable })

    expect(loadToken('/home/.minit', { fs: tokenFs, safeStorage: safeStorageNowAvailable })).toBe('xoxb-legacy')
    const rewritten = JSON.parse(settingsFiles.get('/home/.minit/settings.json')!)
    expect(rewritten.slackBotToken).toBeUndefined()
    expect(rewritten.repoRoot).toBe('/r')
  })

  test('손상된 JSON이면 아무 일도 하지 않는다(loadSettings의 백업 처리가 이후 담당)', () => {
    const tokenFs = fakeFs()
    const safeStorage = fakeSafeStorage()
    const settingsFiles = new Map<string, string>()
    settingsFiles.set('/home/.minit/settings.json', '{oops')

    expect(() =>
      migrateLegacySlackToken('/home/.minit', {
        tokenStoreFs: tokenFs,
        safeStorage,
        readSettingsFile: (p) => settingsFiles.get(p) ?? null,
        writeSettingsFile: () => {
          throw new Error('호출되면 안 됨')
        }
      })
    ).not.toThrow()
  })
})
