// registerIpc가 앱 생명주기 동안 1회 실행하는 설정 초기화 순서를 함수로 못박는다. registerIpc는
// electron 의존(BrowserWindow 등) 때문에 ipc 테스트 하네스가 없어 이 순서 자체를 직접 검증할
// 방법이 없었다 — 순서를 이 순수 함수로 뽑아 TDD 대상으로 만든다(리뷰 Fix 2).
//
// 순서가 중요한 이유: migrateLegacySlackToken은 loadSettings보다 반드시 먼저 실행돼야 한다.
// loadSettings는 v0.3.x가 남긴 평문 slackBotToken을 방어적으로 버리기만 할 뿐 암호화 저장소로
// 옮기지는 않는다(slack-token-store.ts:loadSettings 주석 참고) — 순서가 바뀌면 평문 토큰이
// 암호화 이관 기회 없이 그냥 사라진다.
import { loadSettings, migrateLegacySettings, type Settings } from './settings'
import { migrateLegacySlackToken, type SafeStorageLike, type TokenStoreFs } from './slack-token-store'

export interface InitializeSettingsDeps {
  legacyUserDataDir: string
  configDir: string
  tokenStoreFs: TokenStoreFs
  safeStorage: SafeStorageLike
  readSettingsFile: (path: string) => string | null
  writeSettingsFile: (path: string, content: string) => void
}

export function initializeSettings(deps: InitializeSettingsDeps): Settings {
  // 1) 레거시 userData(플랫폼별 임의 경로) → ~/.minit 설정 파일 위치 이전(1회)
  migrateLegacySettings(deps.legacyUserDataDir, deps.configDir)
  // 2) 레거시 평문 Slack 봇 토큰 → 암호화 저장소 이관 시도(1회, 실패해도 평문은 보존됨)
  migrateLegacySlackToken(deps.configDir, {
    tokenStoreFs: deps.tokenStoreFs,
    safeStorage: deps.safeStorage,
    readSettingsFile: deps.readSettingsFile,
    writeSettingsFile: deps.writeSettingsFile
  })
  // 3) 최종 Settings 로드 — 반드시 위 마이그레이션들 다음이어야 한다
  return loadSettings(deps.configDir, deps.configDir)
}
