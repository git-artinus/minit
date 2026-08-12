import type { ClaudeLoginEvent } from '../shared/types'
import type { AuthStatusResult } from './claude-auth'

/**
 * REPL 없이 도는 독립 서브커맨드다. localhost 루프백 콜백 서버를 띄우고 브라우저를 열어
 * OAuth 동의를 받으므로, 터미널 창 없이 앱이 자식 프로세스로 띄우기만 하면 된다.
 * TTY도 필요 없다(실측 확인).
 */
export const LOGIN_ARGS = ['auth', 'login'] as const

/**
 * 사용자가 브라우저를 닫고 앱을 방치하면 자식이 좀비로 남는다. 타임아웃이 아니라
 * 누수 방지 상한이라 넉넉하게 잡는다 — 실제 로그인은 보통 1분 안에 끝난다.
 */
export const LOGIN_LIMIT_MS = 600_000

export interface ClaudeLoginDeps {
  /** 자식을 띄우고 종료 콜백을 등록한다. onExit은 정상 종료·kill 어느 쪽이든 불린다. */
  spawnLogin: (onExit: () => void) => { kill: () => void }
  /** 자식이 끝난 뒤 사실 확인. exit code를 신뢰하지 않는 이유가 이것이다. */
  verify: () => Promise<AuthStatusResult>
  sendEvent: (e: ClaudeLoginEvent) => void
  /** 실제 타이머를 주입해 상한 경로를 결정적으로 테스트한다(device-flow의 sleep 주입과 같은 이유). */
  setTimer: (ms: number, fn: () => void) => () => void
  limitMs?: number
}

export interface ClaudeLoginSession {
  start: (deps: ClaudeLoginDeps) => void
  /** 현재 세션을 무효화하고 자식을 죽인다. 새 start와 명시적 취소가 같은 경로를 탄다. */
  cancel: () => void
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 상한으로 끊었는지. 앱이 죽인 것을 사용자 미완료로 말하면 앱이 거짓말을 하게 된다. */
type FinishCause = 'exit' | 'limit'

/**
 * 재검증 결과 → 사용자에게 보낼 통지. `AuthStatusResult`를 4분할한 이유가 여기서 살아야 한다 —
 * 확정 미로그인과 판정 불가는 사용자가 할 일이 다르다. 셋을 incomplete로 합치면
 * "다시 시도해 주세요"만 반복되고 원인(구버전 CLI·실행 불가)이 화면에 남지 않는다.
 */
function eventFor(auth: AuthStatusResult, cause: FinishCause, limitMs: number): ClaudeLoginEvent {
  switch (auth.kind) {
    case 'logged-in':
      return { status: 'success' }
    case 'logged-out':
      return cause === 'limit'
        ? {
            status: 'error',
            message: `제한 시간(${Math.round(limitMs / 60000)}분)을 넘겨 로그인을 중단했습니다.`
          }
        : { status: 'incomplete' }
    case 'not-installed':
      return { status: 'error', message: 'claude를 실행할 수 없습니다 — 설치를 확인하세요.' }
    case 'unsupported':
      return {
        status: 'error',
        message:
          '로그인 여부를 확인하지 못했습니다 — Claude CLI가 오래된 버전일 수 있습니다(claude update).'
      }
    default:
      // kind를 추가하면 여기서 컴파일 에러가 난다 — 새 사유가 조용히 한쪽으로 흘러가지 않는다.
      auth satisfies never
      return { status: 'incomplete' }
  }
}

/**
 * 로그인 세션의 경합·취소·상한을 관리한다. github/login-session.ts의 세션 카운터 패턴을
 * 그대로 쓴다 — 무효화된 세션의 결과는 어떤 부수효과도 남기지 않는다.
 *
 * 취소 시 재검증을 하지 않는 것이 의도다. 취소는 사용자 의사이고, kill 직전에 자격증명이
 * 저장됐더라도 다음 [다시 확인]에서 자연히 반영된다. 여기서 성공 이벤트를 보내면
 * 사용자가 방금 닫은 화면이 되살아난다.
 */
export function createClaudeLoginSession(): ClaudeLoginSession {
  let currentSession = 0
  let killCurrent: (() => void) | null = null

  const invalidate = (): void => {
    currentSession++
    killCurrent?.()
    killCurrent = null
  }

  const start = (deps: ClaudeLoginDeps): void => {
    invalidate()
    const sessionId = currentSession
    const limitMs = deps.limitMs ?? LOGIN_LIMIT_MS
    // 상한 kill이 자식 종료를 유발하면 onExit이 다시 불린다 — 이벤트가 두 번 나가면
    // 렌더러가 성공 뒤에 incomplete를 받는 순서 역전이 가능해진다.
    let finished = false
    // finish가 참조하므로 그보다 먼저 선언해야 한다(TDZ).
    let clearLimit: (() => void) | null = null

    const finish = (cause: FinishCause): void => {
      if (finished || sessionId !== currentSession) return
      finished = true
      clearLimit?.()
      void (async (): Promise<void> => {
        try {
          const auth = await deps.verify()
          if (sessionId !== currentSession) return
          deps.sendEvent(eventFor(auth, cause, limitMs))
        } catch (e) {
          if (sessionId !== currentSession) return
          deps.sendEvent({ status: 'error', message: message(e) })
        }
      })()
    }

    let child: { kill: () => void }
    try {
      child = deps.spawnLogin(() => finish('exit'))
    } catch (e) {
      deps.sendEvent({ status: 'error', message: message(e) })
      return
    }
    killCurrent = () => child.kill()

    // 상한을 넘겨도 미완료로 단정하지 않는다 — 그 사이 로그인이 끝났을 수 있어 kill 후에도
    // finish가 사실을 재확인한다. 다만 여전히 미로그인이면 "앱이 끊었다"를 알려야 한다.
    clearLimit = deps.setTimer(limitMs, () => {
      child.kill()
      finish('limit')
    })
  }

  return { start, cancel: invalidate }
}
