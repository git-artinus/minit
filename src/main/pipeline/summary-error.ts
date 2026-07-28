import type { SummaryFailure, SummaryFailureReason } from '../../shared/types'
import { ClaudeRunError, SUMMARY_TIMEOUT_MS } from './claude-run'
import { InvalidOutputError } from './summarizer'

const AUTH_KEYWORDS = [
  'not logged in',
  'please run /login',
  'invalid api key',
  'unauthorized',
  'authentication'
]
const USAGE_KEYWORDS = ['usage limit', 'rate limit', 'quota', 'credit balance', 'too many requests']

const DETAIL_HEAD = 300
const DETAIL_TAIL = 200
// 실측한 claude 진단 출력은 'Not logged in · Please run /login' 같은 한 줄짜리다.
// 모델이 생성한 텍스트는 이보다 훨씬 길다 — 길이가 곧 판별 신호다.
const DIAGNOSTIC_MAX = 400

/**
 * 키워드 검사 대상. stdout 전체를 넣으면 회의 내용이 오분류를 유발한다 —
 * 인증 모듈 설계 회의가 타임아웃되면 부분 출력의 'authentication'이 매칭돼
 * "로그인하세요" 안내가 뜨고, API 회의의 'rate limit'은 사용량 한도로 오진단된다.
 * 미탐은 unknown 폴백이 원문을 노출해 흡수하지만, 오탐은 흡수되지 않는다(틀린 확신을 준다).
 * 그래서 폴백이 아니라 검사 대상 자체를 CLI 진단 출력로 좁힌다.
 */
function diagnosticText(e: ClaudeRunError): string {
  const stdout = e.stdout.trim()
  const looksLikeModelOutput =
    stdout.length > DIAGNOSTIC_MAX || stdout.startsWith('{') || stdout.startsWith('[')
  return [e.stderr.trim(), looksLikeModelOutput ? '' : stdout].filter((s) => s !== '').join('\n')
}

// 앞만 자르면 배너·부분 JSON이 앞선 경우 진짜 원인이 통째로 잘려나간다. 앞뒤를 모두 남기고
// 잘렸다는 사실도 알린다 — 잘린 걸 숨기면 사용자는 그게 전부인 줄 안다.
function truncate(text: string): string {
  if (text.length <= DETAIL_HEAD + DETAIL_TAIL) return text
  const omitted = `…(총 ${text.length}자 중 일부 생략)…`
  return `${text.slice(0, DETAIL_HEAD)}\n${omitted}\n${text.slice(-DETAIL_TAIL)}`
}

// stdout·stderr에 서로 다른 정보가 들어가는 케이스가 실측으로 확인됐다(런타임 오류는
// stdout, CLI 사용법 오류는 stderr). 하나만 고르면 나머지가 통째로 폐기된다.
function buildDetail(e: ClaudeRunError): string {
  const parts: string[] = []
  if (e.timedOut) parts.push(`제한 시간(${SUMMARY_TIMEOUT_MS / 1000}초)을 초과해 중단했습니다.`)
  const stdout = e.stdout.trim()
  const stderr = e.stderr.trim()
  if (stdout !== '') parts.push(`[출력] ${stdout}`)
  if (stderr !== '') parts.push(`[오류] ${stderr}`)
  if (parts.length === 0) {
    parts.push(
      e.exitCode !== null
        ? `exit code ${e.exitCode}으로 종료했습니다.`
        : 'claude가 아무 출력 없이 실패했습니다.'
    )
  }
  return truncate(parts.join('\n'))
}

function decideReason(e: ClaudeRunError): SummaryFailureReason {
  if (e.spawnCode === 'ENOENT') return 'not_installed'
  // 강제 종료라 출력이 없거나 잘려 있다 — 텍스트 판정보다 먼저 가른다.
  if (e.timedOut) return 'timeout'
  const text = diagnosticText(e).toLowerCase()
  if (AUTH_KEYWORDS.some((k) => text.includes(k))) return 'not_authenticated'
  if (USAGE_KEYWORDS.some((k) => text.includes(k))) return 'usage_limit'
  return 'unknown'
}

/**
 * 요약 실패 원인 분류. ClaudeRunError·InvalidOutputError가 아니면 즉시 unknown으로 떨어진다 —
 * 회의록 파일 부재나 git 미설치의 ENOENT를 "claude 미설치"로 오진단하지 않기 위함이다.
 */
export function classifySummaryError(e: unknown): SummaryFailure {
  if (e instanceof InvalidOutputError) {
    return { reason: 'invalid_output', detail: e.excerpt === '' ? e.message : e.excerpt }
  }
  if (!(e instanceof ClaudeRunError)) {
    return { reason: 'unknown', detail: e instanceof Error ? e.message : String(e) }
  }
  const failure: SummaryFailure = { reason: decideReason(e), detail: buildDetail(e) }
  if (e.exitCode !== null) failure.exitCode = e.exitCode
  // 절단 전 전문을 남긴다. 이게 없으면 실패 원인은 휘발성 렌더러 상태로만 존재해,
  // 사용자가 화면을 벗어나는 순간 영구 소실된다(버그 리포트를 받아도 확인할 방법이 없다).
  console.error('[summary] 요약 실패', {
    reason: failure.reason,
    exitCode: e.exitCode,
    spawnCode: e.spawnCode,
    timedOut: e.timedOut,
    stdout: e.stdout,
    stderr: e.stderr
  })
  return failure
}
