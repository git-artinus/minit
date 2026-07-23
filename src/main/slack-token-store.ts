// Slack 봇 토큰 암호화 저장소(v0.4.0 ②). github/token-store.ts와 동일한 코어(token-store-base)를
// slack-token.enc 파일명으로 재사용한다.
import path from 'node:path'
import {
  deleteTokenFile,
  loadTokenFile,
  saveTokenFile,
  tokenFilePathFor,
  type SafeStorageLike,
  type TokenStoreDeps,
  type TokenStoreFs
} from './token-store-base'

export type { SafeStorageLike, TokenStoreDeps, TokenStoreFs }

const FILE_NAME = 'slack-token.enc'
const UNAVAILABLE_MESSAGE = '이 시스템에서는 안전한 저장소(Keychain)를 사용할 수 없어 Slack 토큰을 저장할 수 없습니다'

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

// v0.3.x는 settings.json에 slackBotToken(평문)·slackChannel(#name)을 직접 저장했다. v0.4.0부터는
// 토큰을 여기(암호화 파일)로만 보관하므로, 최초 로드 시 1회 이 함수로 이관한다.
// - slackBotToken이 평문으로 남아 있으면 암호화 저장소로 옮기고 settings.json에서 제거한다.
// - slackChannel(#name)은 채널 ID로 변환할 방법이 없어(목록 조회가 필요) 폐기한다 — 팀원이
//   설정 화면에서 채널을 다시 선택해야 한다(v0.3.x 사용자 극소수·1회성 재선택 유도로 판단).
// safeStorage 미가용 등으로 암호화 저장이 실패하면 아무것도 지우지 않고 그대로 둔다(다음 로드 때
// 재시도 — 평문이 사라져 토큰 자체를 잃어버리는 것보다 안전).
export function migrateLegacySlackToken(
  userDataDir: string,
  deps: {
    tokenStoreFs: TokenStoreFs
    safeStorage: SafeStorageLike
    readSettingsFile: (path: string) => string | null
    writeSettingsFile: (path: string, content: string) => void
  }
): void {
  const settingsFile = path.join(userDataDir, 'settings.json')
  const content = deps.readSettingsFile(settingsFile)
  if (content === null) return

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content)
  } catch {
    return // 손상된 JSON — loadSettings의 corrupt-file 처리가 이후 단계에서 복구한다.
  }

  const legacyToken = parsed.slackBotToken
  if (typeof legacyToken !== 'string' || legacyToken.trim() === '') return

  try {
    saveToken(userDataDir, legacyToken, { fs: deps.tokenStoreFs, safeStorage: deps.safeStorage })
  } catch (error) {
    // 토큰 원문은 절대 로그에 남기지 않는다 — error는 saveTokenFile이 던지는 고정 안내
    // 문구(예: safeStorage 미가용 메시지)뿐, 토큰 값을 포함하지 않는다.
    console.warn(
      '[slack-token-store] 레거시 평문 Slack 토큰 암호화 이관 실패 — 평문을 보존하고 다음 시도 때 재시도합니다:',
      error instanceof Error ? error.message : error
    )
    return
  }

  delete parsed.slackBotToken
  delete parsed.slackChannel
  deps.writeSettingsFile(settingsFile, JSON.stringify(parsed, null, 2))
}
