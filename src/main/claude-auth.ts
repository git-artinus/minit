import type { ClaudeAccount } from '../shared/types'
import { ClaudeRunError } from './pipeline/claude-run'
import { truncateDetail } from './pipeline/summary-error'
import type { RunWithStdin } from './pipeline/summarizer'

/**
 * 로그인 여부만 확인한다. `claude -p` 프로브와 달리 API를 호출하지 않아 사용량을 쓰지 않고
 * 실측 0.15초에 끝난다 — 미로그인 사용자에게까지 사용량 소모를 시도할 이유가 없다.
 */
export const AUTH_STATUS_ARGS = ['auth', 'status', '--json'] as const

/** 로컬 판정이라 네트워크를 타지 않는다. 프로브의 60초를 물려줄 이유가 없다. */
export const AUTH_STATUS_TIMEOUT_MS = 5_000

// 계정 정보는 렌더러(설정 화면)도 쓰므로 shared에 둔다.
export type AuthInfo = ClaudeAccount

/**
 * unsupported가 logged-out과 반드시 갈라져야 한다. `auth status`를 모르는 구버전 CLI는
 * stdout이 비는데, 그걸 "미로그인"으로 읽으면 구버전 사용자 전원이 눌러도 소용없는
 * 로그인 버튼을 보게 된다. unsupported는 기존 프로브 경로로 폴백하라는 신호다.
 */
export type AuthStatusResult =
  | { kind: 'logged-in'; info: AuthInfo }
  | { kind: 'logged-out' }
  | { kind: 'not-installed' }
  | { kind: 'unsupported' }

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

// 첫 '{'부터 마지막 '}'까지만 잘라낸다. 자동 업데이트 배너 등 비-JSON 전문이 앞에 붙을 수
// 있는데, 전체를 그대로 파싱하면 그때마다 unsupported로 떨어져 폴백이 사용량을 태운다.
function extractJson(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? text.slice(start, end + 1) : null
}

/**
 * stdout만 보고 판정한다. **exit code는 쓰지 않는다** — 미로그인이 exit 1이므로
 * 종료 코드로는 "미로그인"과 "명령 실패"를 구분할 수 없다.
 * null은 "판정 불가"이며 호출자가 unsupported로 승격한다.
 */
export function parseAuthStatus(
  stdout: string
): { kind: 'logged-in'; info: AuthInfo } | { kind: 'logged-out' } | null {
  const json = extractJson(stdout)
  if (json === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  // loggedIn이 판정 전부다. 없거나 타입이 다르면 추측하지 않는다.
  if (typeof record.loggedIn !== 'boolean') return null
  if (!record.loggedIn) return { kind: 'logged-out' }

  return {
    kind: 'logged-in',
    info: {
      // 부가 정보 부재로 로그인 판정을 버리지 않는다 — loggedIn:true는 그 자체로 사실이다.
      authMethod: optionalString(record.authMethod) ?? 'unknown',
      email: optionalString(record.email),
      orgName: optionalString(record.orgName),
      subscriptionType: optionalString(record.subscriptionType)
    }
  }
}

/**
 * unsupported로 떨어진 사유를 남긴다. 이 판정은 "무료 확인을 포기하고 사용량을 쓰는 프로브로
 * 폴백한다"는 뜻이라, 현장에서 모든 사용자에게 매번 터지고 있어도 기록이 없으면 아무도 알 수
 * 없다 — 이 모듈의 존재 이유가 조용히 무력화된다. 요약 실패(pipeline/summary-error.ts)와
 * 같은 수준으로 남긴다.
 */
function logUndetermined(reason: string, e: unknown): void {
  const fields: Record<string, unknown> = { reason }
  if (e instanceof ClaudeRunError) {
    const { run } = e
    Object.assign(fields, {
      exitCode: run.exitCode,
      errorCode: run.errorCode,
      signal: run.signal,
      timedOut: e.timedOut,
      stdout: truncateDetail(run.stdout),
      stderr: truncateDetail(run.stderr)
    })
  } else if (e instanceof Error) {
    fields.message = e.message
  }
  console.error('[claude] auth status 판정 불가', fields)
}

/**
 * 로그인 여부 판정. 성공·실패 어느 쪽으로 끝나든 stdout만 본다 —
 * 미로그인이 exit 1(=ClaudeRunError)로 도착하기 때문이다.
 */
export async function checkAuthStatus(deps: { run: RunWithStdin }): Promise<AuthStatusResult> {
  try {
    const { stdout } = await deps.run('claude', [...AUTH_STATUS_ARGS], '', AUTH_STATUS_TIMEOUT_MS)
    const parsed = parseAuthStatus(stdout)
    if (parsed !== null) return parsed
    // 정상 종료했는데 읽을 수 없는 출력 — 형식이 바뀌었거나 앞뒤에 다른 출력이 섞였다.
    logUndetermined('출력을 판정할 수 없음', new Error(truncateDetail(stdout)))
    return { kind: 'unsupported' }
  } catch (e) {
    if (e instanceof ClaudeRunError) {
      if (e.run.errorCode === 'ENOENT') return { kind: 'not-installed' }
      const parsed = parseAuthStatus(e.run.stdout)
      if (parsed !== null) return parsed
    }
    // 타임아웃·구버전 CLI·권한 문제·예상 밖 예외 전부 여기로 온다. 어느 쪽이든 "판정 못 했다"이고,
    // 그 처방은 하나다 — 기존 프로브 경로로 폴백한다. 다만 사유는 남긴다.
    logUndetermined('실행 실패', e)
    return { kind: 'unsupported' }
  }
}
