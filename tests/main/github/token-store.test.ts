import { describe, expect, test } from 'vitest'
import { deleteToken, loadToken, saveToken, tokenFilePath } from '../../../src/main/github/token-store'

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
  test('minitHome 하위 github-token.enc 경로를 반환한다', () => {
    expect(tokenFilePath('/home/.minit')).toBe('/home/.minit/github-token.enc')
  })
})

describe('saveToken → loadToken 왕복', () => {
  test('저장 후 그대로 복호화되어 돌아온다', () => {
    const fs = fakeFs()
    const safeStorage = fakeSafeStorage()
    saveToken('/home/.minit', 'ghu_secret', { fs, safeStorage })
    expect(loadToken('/home/.minit', { fs, safeStorage })).toBe('ghu_secret')
  })

  test('평문으로 저장하지 않는다(디스크에는 암호화된 바이트만 남는다)', () => {
    const fs = fakeFs()
    const safeStorage = fakeSafeStorage()
    saveToken('/home/.minit', 'ghu_secret', { fs, safeStorage })
    const raw = fs.files.get(tokenFilePath('/home/.minit'))!.toString('utf-8')
    expect(raw).not.toBe('ghu_secret')
  })
})

describe('safeStorage 미가용', () => {
  test('저장 시 평문 저장을 거부하고 오류를 던진다', () => {
    const fs = fakeFs()
    const safeStorage = fakeSafeStorage(false)
    expect(() => saveToken('/home/.minit', 'ghu_secret', { fs, safeStorage })).toThrow()
    expect(fs.files.size).toBe(0)
  })

  test('로드 시 안전하게 null을 반환한다', () => {
    const fs = fakeFs()
    const safeStorage = fakeSafeStorage()
    saveToken('/home/.minit', 'ghu_secret', { fs, safeStorage })
    const unavailable = fakeSafeStorage(false)
    expect(loadToken('/home/.minit', { fs, safeStorage: unavailable })).toBeNull()
  })
})

describe('loadToken', () => {
  test('파일이 없으면 null을 반환한다', () => {
    const fs = fakeFs()
    const safeStorage = fakeSafeStorage()
    expect(loadToken('/home/.minit', { fs, safeStorage })).toBeNull()
  })

  test('복호화가 실패하면(손상 등) null을 반환한다', () => {
    const fs = fakeFs()
    fs.files.set(tokenFilePath('/home/.minit'), Buffer.from('garbage'))
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: () => {
        throw new Error('복호화 실패')
      }
    }
    expect(loadToken('/home/.minit', { fs, safeStorage })).toBeNull()
  })
})

describe('deleteToken', () => {
  test('토큰 파일을 삭제한다(없어도 오류 없음)', () => {
    const fs = fakeFs()
    const safeStorage = fakeSafeStorage()
    saveToken('/home/.minit', 'ghu_secret', { fs, safeStorage })
    deleteToken('/home/.minit', { fs })
    expect(loadToken('/home/.minit', { fs, safeStorage })).toBeNull()
    expect(() => deleteToken('/home/.minit', { fs })).not.toThrow()
  })
})

