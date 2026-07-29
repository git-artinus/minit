// 요약은 전적으로 이 기기의 claude CLI에 의존한다(#8). 설치 안내 문구를 설정·온보딩이 공유한다.
export const CLAUDE_INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code'
export const CLAUDE_DOCS_URL = 'https://docs.claude.com/en/docs/claude-code/overview'

/**
 * 의존성 고지. `which claude`는 설치만 증명하므로, 로그인·사용량 때문에 요약이 실패할 수 있다는
 * 사실을 설치 여부 표시와 무관하게 알려야 한다(설정 화면은 상태와 상관없이 무조건 렌더한다).
 */
export const CLAUDE_DEPENDENCY_NOTICE =
  'Minit은 이 기기에 설치된 Claude CLI로 회의록을 요약합니다. CLI가 설치되어 있지 않거나, ' +
  '로그인되어 있지 않거나, 사용량이 남아 있지 않으면 요약이 생성되지 않습니다. ' +
  '(그래도 녹음과 받아쓰기는 계속 사용할 수 있습니다.)'
