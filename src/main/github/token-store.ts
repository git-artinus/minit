// GitHub 토큰 암호화 저장소. 실제 암호화/파일 IO는 ../token-store-base(공용 코어)가 담당하고,
// 여기서는 github-token.enc라는 고정 파일명·오류 메시지만 주입한다(Slack 쪽은
// ../slack-token-store.ts가 동일한 코어를 slack-token.enc로 재사용한다).
import {
  deleteTokenFile,
  loadTokenFile,
  saveTokenFile,
  tokenFilePathFor,
  type SafeStorageLike,
  type TokenStoreDeps,
  type TokenStoreFs
} from '../token-store-base'

export type { SafeStorageLike, TokenStoreDeps, TokenStoreFs }

const FILE_NAME = 'github-token.enc'
const UNAVAILABLE_MESSAGE = '이 시스템에서는 안전한 저장소(Keychain)를 사용할 수 없어 GitHub 토큰을 저장할 수 없습니다'

export function tokenFilePath(minitHomeDir: string): string {
  return tokenFilePathFor(FILE_NAME, minitHomeDir)
}

export function saveToken(minitHomeDir: string, token: string, deps: TokenStoreDeps): void {
  saveTokenFile(tokenFilePath(minitHomeDir), minitHomeDir, token, deps, UNAVAILABLE_MESSAGE)
}

export function loadToken(minitHomeDir: string, deps: TokenStoreDeps): string | null {
  return loadTokenFile(tokenFilePath(minitHomeDir), deps)
}

export function deleteToken(minitHomeDir: string, deps: { fs: TokenStoreFs }): void {
  deleteTokenFile(tokenFilePath(minitHomeDir), deps)
}
