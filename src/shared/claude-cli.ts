// 요약은 전적으로 이 기기의 claude CLI에 의존한다(#8). 설치 안내 문구를 설정·온보딩이 공유한다.

/**
 * 설치 명령. 공식 문서가 Recommended로 제시하는 native installer를 쓴다 —
 * npm 방식(`npm install -g @anthropic-ai/claude-code`)은 Node 22+를 요구하고 문서에서
 * Advanced로 내려갔다. native는 `~/.local/bin`에 설치하므로 sudo가 필요 없고,
 * 그 경로는 shell-path.ts의 FALLBACK_DIRS에 이미 있어 셸 재시작 없이 곧바로 인식된다.
 *
 * 플랫폼으로 갈리는 이유는 Windows에 curl·bash가 없어서다. 한 문자열로 뭉치면
 * 한쪽에서 설치가 통째로 실패한다.
 */
export function claudeInstallCommand(platform: string): string {
  return platform === 'win32'
    ? 'irm https://claude.ai/install.ps1 | iex'
    : 'curl -fsSL https://claude.ai/install.sh | bash'
}

// 현재 플랫폼의 명령을 상수로 두지 않는다 — 이 파일은 렌더러도 import하고, 렌더러에는
// nodeIntegration이 꺼져 있어 process가 없다(모듈 최상위에서 읽으면 화면이 통째로 죽는다).
// 플랫폼은 preload가 window.minuting.platform으로 넘긴다.

/**
 * 위 명령을 실제로 실행할 프로그램과 인자. 명령에 파이프가 있어 셸을 거쳐야 한다 —
 * execFile로 직접 넘기면 파이프가 인자 문자열의 일부가 된다.
 */
export function claudeInstallShell(platform: string): { cmd: string; args: string[] } {
  return platform === 'win32'
    ? {
        // -NoProfile: 사용자 프로필 스크립트가 설치 출력에 섞이거나 실행을 막지 않게 한다.
        cmd: 'powershell.exe',
        args: ['-NoProfile', '-Command', claudeInstallCommand(platform)]
      }
    : { cmd: '/bin/sh', args: ['-c', claudeInstallCommand(platform)] }
}

export const CLAUDE_DOCS_URL = 'https://code.claude.com/docs/en/setup'

/**
 * 의존성 고지. `which claude`는 설치만 증명하므로, 로그인·사용량 때문에 요약이 실패할 수 있다는
 * 사실을 설치 여부 표시와 무관하게 알려야 한다(설정 화면은 상태와 상관없이 무조건 렌더한다).
 */
export const CLAUDE_DEPENDENCY_NOTICE =
  'Minit은 이 기기에 설치된 Claude CLI로 회의록을 요약합니다. CLI가 설치되어 있지 않거나, ' +
  '로그인되어 있지 않거나, 사용량이 남아 있지 않으면 요약이 생성되지 않습니다. ' +
  '(그래도 녹음과 받아쓰기는 계속 사용할 수 있습니다.)'
