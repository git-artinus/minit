import type { ClaudeStatus, SummaryFailure } from '../shared/types'
import { checkAuthStatus, type AuthStatusResult } from './claude-auth'
import type { CommandExists } from './env-check'
import { classifyClaudeFailure } from './pipeline/summary-error'
import type { RunWithStdin } from './pipeline/summarizer'

/**
 * 상태 확인용 최소 프롬프트. 응답 내용은 보지 않는다 — 확인하려는 건 "claude가 요청을
 * 처리하고 정상 종료하는가" 뿐이라, 지시는 짧고 답이 한 단어로 끝나기만 하면 된다.
 */
export const PROBE_PROMPT = 'Reply with exactly: ok'

/**
 * 요약(300초)보다 훨씬 짧게 잡는다. 프롬프트가 한 줄이라 정상이라면 걸리는 시간은 사실상 CLI
 * 기동 시간이고(실측 4.2초), 여기서 오래 끈다는 건 생성이 느린 게 아니라 기동·연결이 막혔다는 뜻이다.
 */
export const PROBE_TIMEOUT_MS = 60_000

/**
 * 실패 사유가 "claude를 쓸 수 있는가"에 대해 실제로 말해 주는 것. 모든 실패가 가용성 문제는
 * 아니다 — invalid_output은 오히려 claude가 응답까지 정상적으로 마쳤다는 증거이고,
 * timeout·unknown은 회의 길이나 일시적 부하일 수 있어 "못 쓴다"의 근거가 못 된다.
 *
 * 요약 실행과 상태 확인이 **같은 기준**을 쓰는 것이 중요하다. 프로브의 timeout만 확정 판정으로
 * 취급하면, 콜드 스타트 한 번이 느렸다는 이유로 멀쩡한 CLI에 세션 내내 경고가 붙는다.
 */
export function availabilityEvidence(failure: SummaryFailure): ClaudeStatus {
  switch (failure.reason) {
    case 'not_installed':
    case 'not_authenticated':
    case 'usage_limit':
      return { kind: 'unavailable', failure }
    case 'invalid_output':
      return { kind: 'available' }
    case 'timeout':
    case 'unknown':
      return { kind: 'undetermined', failure }
    default:
      // 사유를 추가하면 여기서 컴파일 에러가 난다 — 새 사유가 조용히 한쪽으로 흘러가지 않는다.
      failure.reason satisfies never
      return { kind: 'undetermined', failure }
  }
}

/**
 * claude가 지금 요약을 만들 수 있는 상태인지 판정한다. `which claude`로는 알 수 없는
 * 로그인·사용량 문제를 요약 시점이 아니라 그 전에 알려주기 위한 것이다(#8).
 *
 * 3단계이고 앞 두 단계는 사용량을 쓰지 않는다 — 미설치·미로그인은 그 단계에서 확정되므로
 * 거기서 끝낸다. 로그인됨을 확인한 뒤에도 프로브를 돌리는 이유는 `auth status`가
 * 사용량을 모르기 때문이다.
 */
export async function probeClaude(deps: {
  commandExists: CommandExists
  run: RunWithStdin
  // 주입 가능하게 둔다 — 실제 프로세스를 띄우지 않고 3단 분기를 결정적으로 테스트한다.
  checkAuth?: (deps: { run: RunWithStdin }) => Promise<AuthStatusResult>
}): Promise<ClaudeStatus> {
  // 미설치가 확실하면 실행하지 않는다. spawn ENOENT로도 같은 결론이 나오지만, 설치조차 안 한
  // 사용자에게 프로세스 생성을 시도할 이유가 없다.
  if (!(await deps.commandExists('claude'))) {
    return {
      kind: 'unavailable',
      failure: { reason: 'not_installed', detail: 'PATH에서 claude 실행 파일을 찾지 못했습니다.' }
    }
  }

  const auth = await (deps.checkAuth ?? checkAuthStatus)({ run: deps.run })
  if (auth.kind === 'not-installed') {
    return {
      kind: 'unavailable',
      // which는 통과했는데 실행이 ENOENT라면 그 사이 삭제·이동된 것이다.
      failure: { reason: 'not_installed', detail: 'claude 실행 파일을 실행할 수 없습니다.' }
    }
  }
  if (auth.kind === 'logged-out') {
    return {
      kind: 'unavailable',
      failure: { reason: 'not_authenticated', detail: 'Claude CLI에 로그인되어 있지 않습니다.' }
    }
  }

  // logged-in이면 남은 미지수는 사용량뿐이고, unsupported면 로그인 여부조차 프로브가 알아내야 한다.
  try {
    // stdin은 비운다 — 프롬프트를 인자로 넘기므로 넘길 게 없다.
    await deps.run('claude', ['-p', PROBE_PROMPT], '', PROBE_TIMEOUT_MS)
    return { kind: 'available' }
  } catch (e) {
    return availabilityEvidence(classifyClaudeFailure(e, '상태 확인'))
  }
}

export interface ClaudeStatusChecker {
  /**
   * 캐시된 판정을 주고, 없으면 프로브를 1회 실행한다.
   * force=true면 캐시를 무시하고 다시 실행한다 — 사용량을 쓰므로 사용자가 요청할 때만 쓴다.
   */
  get: (force?: boolean) => Promise<ClaudeStatus>
  /**
   * 프로브 밖에서 확인된 판정을 반영한다 — 실제 요약 실행·재생성이 알아낸 사실이다.
   * 프로브를 돌리지 않으므로 사용량을 쓰지 않는다.
   */
  record: (status: ClaudeStatus) => void
}

// 판정이 실질적으로 바뀌었는지. detail은 보지 않는다 — 화면 문구와 사용자가 할 일은 reason이
// 결정하고, 같은 reason의 detail 차이는 안내를 바꾸지 않는다(불필요한 렌더만 늘린다).
function statusKey(s: ClaudeStatus): string {
  return s.kind === 'available' ? s.kind : `${s.kind}:${s.failure.reason}`
}

/**
 * 프로브 결과를 앱 실행 동안 들고 있는다. 디스크에 남기지 않는 이유는 이 판정이 쉽게 낡기
 * 때문이다 — 로그아웃·사용량 소진은 앱 밖에서 일어나므로, 저장된 "사용 가능"은 틀린 확신을
 * 주고 저장된 "로그인 필요"는 이미 로그인한 사용자를 계속 붙잡는다.
 *
 * onChanged는 record가 판정을 실제로 바꿨을 때만 부른다. get의 결과는 호출자가 반환값으로
 * 받지만 record는 아무도 기다리지 않기 때문에, 이 통지가 없으면 요약 실행이 알아낸 사실이
 * main에만 남고 화면은 앱 실행 시점의 값에 머문다.
 */
export function createClaudeStatusChecker(
  probe: () => Promise<ClaudeStatus>,
  onChanged: (status: ClaudeStatus) => void = () => {}
): ClaudeStatusChecker {
  let cached: ClaudeStatus | null = null
  let inFlight: Promise<ClaudeStatus> | null = null
  // 프로브와 record 중 어느 쪽이 더 새로운 사실인지 가리는 근거. 시각이 아니라 순번인 이유는
  // 두 값이 같은 밀리초에 도착할 수 있어서다.
  let recorded = 0

  return {
    async get(force = false) {
      if (!force) {
        if (cached !== null) return cached
        // 동시 호출을 하나로 합친다. StrictMode의 이중 마운트나 조회자가 늘면 프로브가 두 번
        // 돌아 사용량을 두 배로 쓴다.
        if (inFlight !== null) return inFlight
      }
      const recordedAtStart = recorded
      const run = probe()
      inFlight = run
      try {
        const status = await run
        // 프로브가 도는 사이 실제 실행 결과가 들어왔으면 그쪽이 더 새로운 사실이다. 이 프로브는
        // 한도에 걸리기 전에 나간 요청일 수 있어, 덮으면 방금 실패한 CLI가 "사용 가능"이 된다.
        if (recorded !== recordedAtStart) return cached ?? status
        // undetermined는 캐시하지 않는다 — 다음 조회에서 다시 시도해야 한다. 호출자에게는
        // 사실대로 돌려줘 설정 화면이 "확인 실패"를 표시할 수 있게 한다.
        if (status.kind !== 'undetermined') cached = status
        return status
      } finally {
        // force가 겹치면 나중 실행이 inFlight의 주인이다 — 남의 것을 지우지 않는다.
        if (inFlight === run) inFlight = null
      }
    },
    record(status) {
      // 결론이 아니므로 이미 아는 사실을 "모름"으로 되돌리지 않고, 진행 중인 프로브도 막지 않는다.
      if (status.kind === 'undetermined') return
      recorded++
      if (cached !== null && statusKey(cached) === statusKey(status)) return
      cached = status
      onChanged(status)
    }
  }
}
