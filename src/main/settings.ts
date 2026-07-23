import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Settings {
  repoRoot: string; modelName: string; autoPush: boolean
  // Slack 연동(v0.4.0 ②) — 봇 토큰 자체는 여기 저장하지 않는다(slack-token-store.ts가 별도
  // 암호화 파일로 관리). 채널은 드롭다운에서 선택한 채널 ID를 저장하고, 이름은 표시용으로만 둔다.
  slackChannelId: string | null; slackChannelName: string | null; slackPromptShown: boolean
  // GitHub 연동(v0.3.0 ③) — 토큰 자체는 여기 저장하지 않는다(github/token-store.ts가 별도
  // 암호화 파일로 관리). pendingUploads는 내부 관리 필드(ipc.ts settings:update patch로는
  // 변경할 수 없다 — 업로드 실패 시 큐에 추가·재시도 성공 시 제거는 sync.ts가 담당). githubSync는
  // 업로드/pull 자동 동기화 실행 여부(v0.4.0 ④) — 레포를 처음 선택하는 시점에 자동으로 true가 된다.
  githubRepo: string | null; githubPromptShown: boolean; githubSync: boolean; pendingUploads: string[]
}

// 회의록·설정 저장 기본 홈. DMG로 설치한 패키징 앱은 repoRoot 기본값이
// process.cwd()(더블클릭 실행 시 무의미한 경로)라 저장에 실패했다 — 항상 존재하는
// 홈 디렉토리 하위 고정 경로로 대체한다.
export function minitHome(): string {
  return path.join(os.homedir(), '.minit')
}

// 기존 Electron userData(플랫폼별 임의 경로)에 있던 settings.json을 ~/.minit으로 1회 이전한다.
// 새 위치에 이미 파일이 있으면(이미 마이그레이션 완료) 손대지 않는다.
//
// repoRoot가 더 이상 존재하지 않는 경로(예: 구버전이 남긴 process.cwd() 값)면 이관 시
// minitHome()으로 치환한다 — 그대로 이관하면 앱이 존재하지 않는 경로에 저장을 시도해
// 계속 실패하는 문제가 재발한다(v0.3.1 Fix 4). 나머지 필드는 그대로 이관한다.
export function migrateLegacySettings(legacyDir: string, newDir: string): void {
  const legacyFile = path.join(legacyDir, 'settings.json')
  const newFile = path.join(newDir, 'settings.json')
  if (fs.existsSync(newFile) || !fs.existsSync(legacyFile)) return

  fs.mkdirSync(newDir, { recursive: true })

  const content = fs.readFileSync(legacyFile, 'utf-8')
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed.repoRoot === 'string' && !fs.existsSync(parsed.repoRoot)) {
      parsed.repoRoot = minitHome()
    }
    fs.writeFileSync(newFile, JSON.stringify(parsed, null, 2))
  } catch {
    // 손상된 JSON은 그대로 이관 — loadSettings의 corrupt-file 처리가 이후 단계에서 복구한다.
    fs.writeFileSync(newFile, content)
  }
}

// settings.json은 사용자가 직접 편집하거나 이전 버전이 남긴 손상된 값을 가질 수 있는 신뢰
// 경계 밖 데이터다. 병합 직후 형태가 어긋난 필드를 가벼운 기본값으로 되돌려 이후 로직(예:
// pendingUploads.filter/includes)이 타입 가정 위반으로 죽지 않게 방어한다.
function normalizeSettings(merged: Settings, defaults: Settings): Settings {
  return {
    ...merged,
    pendingUploads:
      Array.isArray(merged.pendingUploads) && merged.pendingUploads.every((f) => typeof f === 'string')
        ? merged.pendingUploads
        : [],
    slackChannelId:
      merged.slackChannelId === null || typeof merged.slackChannelId === 'string' ? merged.slackChannelId : null,
    slackChannelName:
      merged.slackChannelName === null || typeof merged.slackChannelName === 'string'
        ? merged.slackChannelName
        : null,
    githubRepo: merged.githubRepo === null || typeof merged.githubRepo === 'string' ? merged.githubRepo : null,
    autoPush: typeof merged.autoPush === 'boolean' ? merged.autoPush : defaults.autoPush,
    githubSync: typeof merged.githubSync === 'boolean' ? merged.githubSync : defaults.githubSync,
    slackPromptShown: typeof merged.slackPromptShown === 'boolean' ? merged.slackPromptShown : defaults.slackPromptShown,
    githubPromptShown:
      typeof merged.githubPromptShown === 'boolean' ? merged.githubPromptShown : defaults.githubPromptShown
  }
}

export function loadSettings(userDataDir: string, defaultRepoRoot: string): Settings {
  const file = path.join(userDataDir, 'settings.json')
  const defaults: Settings = {
    repoRoot: defaultRepoRoot, modelName: 'ggml-large-v3-turbo.bin', autoPush: true,
    slackChannelId: null, slackChannelName: null, slackPromptShown: false,
    githubRepo: null, githubPromptShown: false, githubSync: false, pendingUploads: [],
  }

  fs.mkdirSync(userDataDir, { recursive: true })

  try {
    const content = fs.readFileSync(file, 'utf-8')
    const parsed = JSON.parse(content)
    // v0.3.x가 남긴 평문 slackBotToken·문자열 slackChannel은 더 이상 Settings 필드가 아니다
    // (slack-token-store.migrateLegacySlackToken이 토큰을 암호화 저장소로 옮기고 ipc.ts에서
    // 먼저 제거한다). 그 호출 이전에 loadSettings가 단독으로 불릴 수도 있으므로(테스트 등),
    // 여기서도 방어적으로 걸러내 stray 필드가 settings.json에 남지 않게 한다.
    delete parsed.slackBotToken
    delete parsed.slackChannel
    return normalizeSettings({ ...defaults, ...parsed }, defaults)
  } catch (error) {
    // File missing → write defaults and return
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fs.writeFileSync(file, JSON.stringify(defaults, null, 2))
      return defaults
    }

    // JSON.parse failed (corrupt file) → backup and write defaults
    const bakFile = path.join(userDataDir, 'settings.json.bak')
    const corruptContent = fs.readFileSync(file, 'utf-8')
    fs.writeFileSync(bakFile, corruptContent)
    fs.writeFileSync(file, JSON.stringify(defaults, null, 2))
    return defaults
  }
}

// 리뷰 Fix 1 — 디스크에 이미 있던 필드를 보존한 채 병합 저장한다. settings 인자는 Settings
// 타입 정식 필드만 담고 있어, 그대로 덮어쓰면 아직 이관되지 않은 레거시 필드(예: safeStorage
// 미가용으로 암호화 저장에 실패해 남아 있는 평문 slackBotToken)를 다른 설정 변경(로그아웃 등)이
// settings.json을 다시 쓸 때마다 통째로 지워버린다 — 이관 기회를 영영 잃는다. 디스크 원본을
// 먼저 읽어 그 위에 settings를 덮어써 정식 필드는 갱신하되 미이관 필드는 그대로 남긴다.
export function saveSettings(userDataDir: string, settings: Settings): void {
  fs.mkdirSync(userDataDir, { recursive: true })
  const file = path.join(userDataDir, 'settings.json')
  let raw: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>
  } catch {
    // 파일 없음·손상된 JSON — 병합 없이 settings만으로 새로 쓴다.
  }
  fs.writeFileSync(file, JSON.stringify({ ...raw, ...settings }, null, 2))
}
