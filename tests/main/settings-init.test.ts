import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initializeSettings } from '../../src/main/settings-init'
import { loadToken } from '../../src/main/slack-token-store'

function fakeSafeStorage(available = true): {
  isEncryptionAvailable: () => boolean
  encryptString: (s: string) => Buffer
  decryptString: (b: Buffer) => string
} {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8').replace(/^enc:/, '')
  }
}

function fakeTokenFs(): {
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

const readSettingsFile = (p: string): string | null => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null)
const writeSettingsFile = (p: string, content: string): void => fs.writeFileSync(p, content)

// 리뷰 Fix 2 — registerIpc는 electron(BrowserWindow) 의존이라 ipc 레벨 테스트 하네스가 없다.
// migrateLegacySettings → migrateLegacySlackToken → loadSettings 순서 의존을 여기 순수 함수
// 단위로 못박는다.
describe('initializeSettings', () => {
  test('레거시 평문 slackBotToken이 있으면 loadSettings 결과에는 평문이 없고, 암호화 저장소로 이관된다', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-init-'))
    const legacyUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-init-legacy-'))
    try {
      fs.writeFileSync(
        path.join(configDir, 'settings.json'),
        JSON.stringify({ repoRoot: configDir, slackBotToken: 'xoxb-legacy', slackChannel: '#회의록' }, null, 2)
      )

      const tokenFs = fakeTokenFs()
      const safeStorage = fakeSafeStorage(true)

      const result = initializeSettings({
        legacyUserDataDir,
        configDir,
        tokenStoreFs: tokenFs,
        safeStorage,
        readSettingsFile,
        writeSettingsFile
      })

      expect(result).not.toHaveProperty('slackBotToken')
      expect(result).not.toHaveProperty('slackChannel')

      // 암호화 저장소로 실제 이관 호출됐음을 왕복으로 검증
      expect(loadToken(configDir, { fs: tokenFs, safeStorage })).toBe('xoxb-legacy')

      const raw = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf-8'))
      expect(raw.slackBotToken).toBeUndefined()
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true })
      fs.rmSync(legacyUserDataDir, { recursive: true, force: true })
    }
  })

  test('순서 회귀 방지: 레거시 위치(userData)에만 평문 토큰이 있어도 이전 후 이관까지 끝난다', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-init-'))
    fs.rmSync(configDir, { recursive: true, force: true }) // 새 위치는 아직 없는 상태를 재현
    const legacyUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-init-legacy-'))
    try {
      fs.writeFileSync(
        path.join(legacyUserDataDir, 'settings.json'),
        JSON.stringify({ repoRoot: legacyUserDataDir, slackBotToken: 'xoxb-legacy-old-location' }, null, 2)
      )

      const tokenFs = fakeTokenFs()
      const safeStorage = fakeSafeStorage(true)

      const result = initializeSettings({
        legacyUserDataDir,
        configDir,
        tokenStoreFs: tokenFs,
        safeStorage,
        readSettingsFile,
        writeSettingsFile
      })

      // migrateLegacySettings가 먼저 실행돼 configDir에 파일이 생기고, 그 다음 슬랙 토큰 이관이
      // 그 위치를 대상으로 실행돼야 한다 — 순서가 바뀌면(loadSettings 먼저) 이 값이 사라진다.
      expect(result).not.toHaveProperty('slackBotToken')
      expect(loadToken(configDir, { fs: tokenFs, safeStorage })).toBe('xoxb-legacy-old-location')
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true })
      fs.rmSync(legacyUserDataDir, { recursive: true, force: true })
    }
  })

  test('safeStorage 미가용이면 평문은 디스크에 보존되고(다음 재시도 가능), 메모리 결과에서만 걸러진다', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-init-'))
    const legacyUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-init-legacy-'))
    try {
      fs.writeFileSync(
        path.join(configDir, 'settings.json'),
        JSON.stringify({ repoRoot: configDir, slackBotToken: 'xoxb-legacy' }, null, 2)
      )

      const tokenFs = fakeTokenFs()
      const safeStorage = fakeSafeStorage(false)

      const result = initializeSettings({
        legacyUserDataDir,
        configDir,
        tokenStoreFs: tokenFs,
        safeStorage,
        readSettingsFile,
        writeSettingsFile
      })

      expect(result).not.toHaveProperty('slackBotToken')
      const raw = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf-8'))
      expect(raw.slackBotToken).toBe('xoxb-legacy')
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true })
      fs.rmSync(legacyUserDataDir, { recursive: true, force: true })
    }
  })
})
