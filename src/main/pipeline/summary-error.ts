import type { SummaryFailure, SummaryFailureReason } from '../../shared/types'
import { ClaudeRunError } from './claude-run'
import { InvalidOutputError } from './summarizer'

// claude 고유 문구만 남긴다. 'authentication'·'unauthorized' 같은 범용 단어를 넣으면 사내 프록시의
// "proxy authentication required"가 "Claude에 로그인하세요"로 오분류돼, 멀쩡한 로그인을 다시 하게
// 만든다. 미탐은 unknown 폴백이 원문을 노출해 흡수하지만 오탐은 흡수되지 않는다.
const AUTH_KEYWORDS = ['not logged in', 'please run /login', 'invalid api key']
const USAGE_KEYWORDS = ['usage limit', 'rate limit', 'quota', 'credit balance', 'too many requests']

const DETAIL_HEAD = 300
const DETAIL_TAIL = 200
// 실측한 claude 진단 출력은 'Not logged in · Please run /login'처럼 한 줄(약 32자)이다. 모델이
// 생성한 텍스트는 이보다 훨씬 길어 길이가 곧 판별 신호가 된다. 여러 줄 안내(한도 리셋 시각·링크
// 등)까지 받아들이려고 여유를 크게 뒀다 — 넘으면 검사에서 빠져 unknown이 되고 원문은 남는다.
const DIAGNOSTIC_MAX = 400
// 로그는 진단용이라 넉넉하되 무한하지 않게 자른다. maxBuffer가 64MB이므로 전문을 그대로 덤프하면
// 최악의 경우 64MB 문자열을 동기 write하며 main 프로세스가 멈춘다.
const LOG_MAX = 4000

// 모델 출력의 시작 형태. claude는 JSON을 ``` 펜스로 감싸 내놓기도 한다(parseClaudeOutput이
// 펜스 정규식을 갖고 있는 게 그 증거다) — 펜스를 빼먹으면 요약 본문의 'rate limit' 같은 단어가
// 사용량 한도로 오분류된다.
const MODEL_OUTPUT_PREFIXES = ['{', '[', '```']

/**
 * 키워드 검사 대상. stdout 전체를 넣으면 회의 내용이 오분류를 유발한다 — claude가 모델 출력을
 * 일부 쓴 뒤 실패하면 요약 본문의 'rate limit' 같은 단어가 매칭된다.
 * 미탐은 unknown 폴백이 원문을 노출해 흡수하지만, 오탐은 흡수되지 않는다(틀린 확신을 준다).
 * 그래서 폴백이 아니라 검사 대상 자체를 CLI 진단 출력로 좁힌다.
 */
function diagnosticText(e: ClaudeRunError): string {
  const stdout = e.run.stdout.trim()
  const looksLikeModelOutput =
    stdout.length > DIAGNOSTIC_MAX || MODEL_OUTPUT_PREFIXES.some((p) => stdout.startsWith(p))
  return [e.run.stderr.trim(), looksLikeModelOutput ? '' : stdout]
    .filter((s) => s !== '')
    .join('\n')
}

// 앞만 자르면 배너·부분 JSON이 앞선 경우 진짜 원인이 통째로 잘려나간다. 앞뒤를 모두 남기고
// 잘렸다는 사실도 알린다 — 잘린 걸 숨기면 사용자는 그게 전부인 줄 안다.
export function truncateDetail(text: string): string {
  if (text.length <= DETAIL_HEAD + DETAIL_TAIL) return text
  const omitted = `…(총 ${text.length}자 중 일부 생략)…`
  return `${text.slice(0, DETAIL_HEAD)}\n${omitted}\n${text.slice(-DETAIL_TAIL)}`
}

// 스트림별로 자른다 — 합친 뒤 한 번에 자르면 뒤쪽 스트림의 라벨이 생략 구간에 묻혀
// 사용자가 그 텍스트가 어느 스트림인지 알 수 없다.
function labeled(label: string, text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : `[${label}] ${truncateDetail(trimmed)}`
}

// stdout·stderr에 서로 다른 정보가 들어가는 케이스가 실측으로 확인됐다(런타임 오류는
// stdout, CLI 사용법 오류는 stderr). 하나만 고르면 나머지가 통째로 폐기된다.
function buildDetail(e: ClaudeRunError): string {
  const { run } = e
  const parts: (string | null)[] = []
  if (e.timedOut)
    parts.push(`제한 시간(${Math.round(run.timeoutMs / 1000)}초)을 초과해 중단했습니다.`)
  else if (run.signal !== null)
    parts.push(`시그널 ${run.signal}로 강제 종료됐습니다(메모리 부족 등).`)
  // spawn 자체가 실패한 경우(errorCode)엔 입력 전달 실패가 결과일 뿐이라 언급하지 않는다.
  if (run.stdinFailed && run.errorCode === null) {
    parts.push(
      '트랜스크립트를 끝까지 전달하지 못했습니다 — 요약이 일부 내용만 반영했을 수 있습니다.'
    )
  }
  if (run.errorCode !== null) parts.push(`오류 코드: ${run.errorCode}`)
  parts.push(labeled('출력', run.stdout), labeled('오류', run.stderr))

  const kept = parts.filter((p): p is string => p !== null && p !== '')
  if (kept.length > 0) return kept.join('\n')
  return run.exitCode !== null
    ? `exit code ${run.exitCode}으로 종료했습니다.`
    : 'claude가 아무 출력 없이 실패했습니다.'
}

function decideReason(e: ClaudeRunError): SummaryFailureReason {
  if (e.run.errorCode === 'ENOENT') return 'not_installed'
  // 강제 종료라 출력이 없거나 잘려 있다 — 텍스트 판정보다 먼저 가른다.
  if (e.timedOut) return 'timeout'
  const text = diagnosticText(e).toLowerCase()
  if (AUTH_KEYWORDS.some((k) => text.includes(k))) return 'not_authenticated'
  if (USAGE_KEYWORDS.some((k) => text.includes(k))) return 'usage_limit'
  return 'unknown'
}

function describe(e: unknown): SummaryFailure {
  if (e instanceof InvalidOutputError) {
    // 응답 원문을 truncate로 통과시켜 절단 정책을 한 곳으로 통일한다(앞뒤 보존 + 생략 고지).
    const raw = e.raw.trim()
    return { reason: 'invalid_output', detail: raw === '' ? e.message : truncateDetail(raw) }
  }
  if (!(e instanceof ClaudeRunError)) {
    return { reason: 'unknown', detail: e instanceof Error ? e.message : String(e) }
  }
  return { reason: decideReason(e), detail: buildDetail(e) }
}

function forLog(text: string): string {
  return text.length <= LOG_MAX ? text : `${text.slice(0, LOG_MAX)}…(총 ${text.length}자)`
}

// 모든 사유를 남긴다. 이게 없으면 실패 원인이 휘발성 렌더러 상태로만 존재해 화면을 벗어나는
// 순간 사라진다. 단, 이 레포엔 파일 로거가 없어 패키징된 앱의 stderr는 사용자가 회수할 수 없다 —
// 개발 실행(`npm run dev`)에서 원인을 확인하는 용도다(파일 로깅은 후속 과제).
function logFailure(context: string, failure: SummaryFailure, e: unknown): void {
  const fields: Record<string, unknown> = { reason: failure.reason }
  if (e instanceof ClaudeRunError) {
    const { run } = e
    Object.assign(fields, {
      exitCode: run.exitCode,
      errorCode: run.errorCode,
      signal: run.signal,
      killed: run.killed,
      timedOut: e.timedOut,
      stdinFailed: run.stdinFailed,
      stdout: forLog(run.stdout),
      stderr: forLog(run.stderr)
    })
  } else if (e instanceof InvalidOutputError) {
    fields.raw = forLog(e.raw)
  } else if (e instanceof Error) {
    fields.stack = e.stack
  }
  console.error(`[claude] ${context} 실패`, fields)
}

/**
 * claude 실행 실패 원인 분류. ClaudeRunError·InvalidOutputError가 아니면 즉시 unknown으로
 * 떨어진다 — 회의록 파일 부재나 git 미설치의 ENOENT를 "claude 미설치"로 오진단하지 않기 위함이다.
 *
 * context는 로그 식별용이다. 요약 생성과 상태 확인이 같은 분류기를 쓰는데 로그 문구가 하나면
 * 어느 쪽이 실패했는지 구분할 수 없다.
 */
export function classifyClaudeFailure(e: unknown, context: string): SummaryFailure {
  const failure = describe(e)
  logFailure(context, failure, e)
  return failure
}
