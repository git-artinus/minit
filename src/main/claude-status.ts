import type { ClaudeStatus, SummaryFailure } from '../shared/types'
import type { CommandExists } from './env-check'
import { classifyClaudeFailure } from './pipeline/summary-error'
import type { RunWithStdin } from './pipeline/summarizer'

/**
 * 상태 확인용 최소 프롬프트. 이 실행도 사용자의 Claude 사용량을 소모하므로 지시는 짧을수록 좋다.
 * 회의록 프롬프트와 달리 영어인 이유는 토큰 수다 — 같은 지시가 절반 이하로 인코딩된다.
 * 응답 내용은 보지 않는다. 확인하려는 건 "claude가 요청을 처리하고 정상 종료하는가" 뿐이다.
 */
export const PROBE_PROMPT = 'Reply with exactly: ok'

/**
 * 요약(300초)보다 훨씬 짧게 잡는다. 프롬프트가 한 줄이라 정상이라면 걸리는 시간은 사실상 CLI
 * 기동 시간이고, 여기서 오래 끈다는 건 생성이 느린 게 아니라 기동·연결이 막혔다는 뜻이다.
 */
export const PROBE_TIMEOUT_MS = 60_000

/**
 * claude를 실제로 1회 실행해 사용 가능 여부를 판정한다. `which claude`로는 알 수 없는
 * 로그인·사용량 문제를 요약 시점이 아니라 그 전에 알려주기 위한 것이다(#8).
 */
export async function probeClaude(deps: {
  commandExists: CommandExists
  run: RunWithStdin
}): Promise<ClaudeStatus> {
  // 미설치가 확실하면 실행하지 않는다. spawn ENOENT로도 같은 결론이 나오지만, 설치조차 안 한
  // 사용자에게 프로세스 생성을 시도할 이유가 없다.
  if (!(await deps.commandExists('claude'))) {
    return {
      ok: false,
      failure: { reason: 'not_installed', detail: 'PATH에서 claude 실행 파일을 찾지 못했습니다.' }
    }
  }
  try {
    // stdin은 비운다 — 프롬프트를 인자로 넘기므로 넘길 게 없다.
    await deps.run('claude', ['-p', PROBE_PROMPT], '', PROBE_TIMEOUT_MS)
    return { ok: true }
  } catch (e) {
    return { ok: false, failure: classifyClaudeFailure(e, '상태 확인') }
  }
}

/**
 * 요약 실행 결과가 "claude를 쓸 수 있는가"에 대해 실제로 말해 주는 것. 모든 실패가 가용성
 * 문제는 아니다 — invalid_output은 오히려 claude가 응답까지 정상적으로 마쳤다는 증거이고,
 * timeout·unknown은 회의 길이나 일시적 문제일 수 있어 상태를 뒤집을 근거가 못 된다.
 * 근거 없이 캐시를 덮으면 설정 화면이 멀쩡한 CLI를 "사용 불가"로 표시한다.
 *
 * null = 이 실패로부터 아무것도 결론지을 수 없음(캐시를 건드리지 않는다).
 */
export function availabilityEvidence(failure: SummaryFailure | null): ClaudeStatus | null {
  if (failure === null) return { ok: true }
  switch (failure.reason) {
    case 'not_installed':
    case 'not_authenticated':
    case 'usage_limit':
      return { ok: false, failure }
    case 'invalid_output':
      return { ok: true }
    case 'timeout':
    case 'unknown':
      return null
    default:
      // 사유를 추가하면 여기서 컴파일 에러가 난다 — 새 사유를 조용히 '결론 없음'으로 흘리지 않는다.
      failure.reason satisfies never
      return null
  }
}

export interface ClaudeStatusChecker {
  /** 캐시된 판정을 주고, 없으면 프로브를 1회 실행한다. force=true면 캐시를 무시하고 다시 실행한다. */
  get: (force?: boolean) => Promise<ClaudeStatus>
  /**
   * 실제 요약 실행에서 얻은 판정을 반영한다. 프로브를 돌리지 않고 얻는 무료 증거다.
   * null이면 아무것도 하지 않는다 — 호출부가 availabilityEvidence의 결과를 그대로 넘길 수 있게.
   */
  record: (status: ClaudeStatus | null) => void
}

/**
 * 프로브 결과를 앱 실행 동안 들고 있는다. 디스크에 남기지 않는 이유는 이 판정이 쉽게 낡기
 * 때문이다 — 로그아웃·사용량 소진은 앱 밖에서 일어나므로, 저장된 "사용 가능"은 틀린 확신을
 * 주고 저장된 "로그인 필요"는 이미 로그인한 사용자를 계속 붙잡는다. 실행마다 한 번 확인하고,
 * 그 뒤로는 실제 요약 실행이 공짜로 갱신한다.
 */
export function createClaudeStatusChecker(probe: () => Promise<ClaudeStatus>): ClaudeStatusChecker {
  let cached: ClaudeStatus | null = null
  let inFlight: Promise<ClaudeStatus> | null = null

  return {
    async get(force = false) {
      if (!force) {
        if (cached !== null) return cached
        // 진행 중인 프로브에 합류시킨다. 온보딩 패널과 설정 화면이 같이 열리면 실행이 두 번
        // 돌아 사용량을 두 배로 쓴다.
        if (inFlight !== null) return inFlight
      }
      const run = probe()
      inFlight = run
      try {
        cached = await run
        return cached
      } finally {
        // force가 겹치면 나중 실행이 inFlight의 주인이다 — 남의 것을 지우지 않는다.
        if (inFlight === run) inFlight = null
      }
    },
    record(status) {
      if (status !== null) cached = status
    }
  }
}
