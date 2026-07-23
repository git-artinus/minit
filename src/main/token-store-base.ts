// GitHub·Slack 토큰 저장소(github/token-store.ts, slack-token-store.ts)가 공유하는 핵심 로직.
// safeStorage(Keychain 기반) 암호화 파일 하나를 다루는 최소 단위로, 파일명·미가용 메시지만
// 호출부가 다르게 주입한다(중복 최소화).
import path from 'node:path'

// Electron safeStorage와 fs를 주입 가능한 형태로 좁혀 TDD를 허용한다(실제 런타임에는
// 'electron'의 safeStorage·node:fs를 그대로 넘긴다).
export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}
export interface TokenStoreFs {
  existsSync: (p: string) => boolean
  writeFileSync: (p: string, data: Buffer) => void
  readFileSync: (p: string) => Buffer
  rmSync: (p: string, opts?: { force?: boolean }) => void
  mkdirSync: (p: string, opts?: { recursive?: boolean }) => void
}
export interface TokenStoreDeps {
  fs: TokenStoreFs
  safeStorage: SafeStorageLike
}

export function tokenFilePathFor(fileName: string, minitHomeDir: string): string {
  return path.join(minitHomeDir, fileName)
}

// safeStorage(Keychain 기반) 암호화 후 저장한다. safeStorage 미가용(isEncryptionAvailable
// false) 환경에서는 평문 저장을 절대 하지 않고 오류를 던진다.
export function saveTokenFile(
  filePath: string,
  minitHomeDir: string,
  token: string,
  deps: TokenStoreDeps,
  unavailableMessage: string
): void {
  if (!deps.safeStorage.isEncryptionAvailable()) {
    throw new Error(unavailableMessage)
  }
  deps.fs.mkdirSync(minitHomeDir, { recursive: true })
  const encrypted = deps.safeStorage.encryptString(token)
  deps.fs.writeFileSync(filePath, encrypted)
}

// 파일 없음·safeStorage 미가용·복호화 실패(손상) 모두 null로 흡수한다 — 로그인 안 된 상태로 취급.
export function loadTokenFile(filePath: string, deps: TokenStoreDeps): string | null {
  if (!deps.fs.existsSync(filePath) || !deps.safeStorage.isEncryptionAvailable()) return null
  try {
    return deps.safeStorage.decryptString(deps.fs.readFileSync(filePath))
  } catch {
    return null
  }
}

export function deleteTokenFile(filePath: string, deps: { fs: TokenStoreFs }): void {
  deps.fs.rmSync(filePath, { force: true })
}
