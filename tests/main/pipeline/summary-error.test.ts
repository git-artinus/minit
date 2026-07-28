import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ClaudeRunError, type ClaudeRunFacts } from '../../../src/main/pipeline/claude-run'
import { classifySummaryError } from '../../../src/main/pipeline/summary-error'
import { InvalidOutputError } from '../../../src/main/pipeline/summarizer'

// classifySummaryError는 진단 전문을 console.error로 남긴다(원인 영구 소실 방지). 출력만 죽인다.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function runError(over: Partial<ClaudeRunFacts> = {}): ClaudeRunError {
  return new ClaudeRunError({
    stdout: '',
    stderr: '',
    exitCode: 1,
    errorCode: null,
    killed: false,
    signal: null,
    timeoutMs: 300_000,
    stdinFailed: false,
    ...over
  })
}

const timedOut = (over: Partial<ClaudeRunFacts> = {}): ClaudeRunError =>
  runError({ exitCode: null, killed: true, signal: 'SIGTERM', ...over })

describe('classifySummaryError — 사유 판정', () => {
  test('spawn ENOENT는 미설치', () => {
    expect(classifySummaryError(runError({ errorCode: 'ENOENT', exitCode: null })).reason).toBe(
      'not_installed'
    )
  })

  test('로그인 안 됨(stdout)은 미인증', () => {
    expect(
      classifySummaryError(runError({ stdout: 'Not logged in · Please run /login' })).reason
    ).toBe('not_authenticated')
  })

  test('API 키 무효도 미인증', () => {
    expect(
      classifySummaryError(runError({ stdout: 'Invalid API key · Fix external API key' })).reason
    ).toBe('not_authenticated')
  })

  test('대소문자를 가리지 않는다', () => {
    expect(classifySummaryError(runError({ stdout: 'NOT LOGGED IN' })).reason).toBe(
      'not_authenticated'
    )
  })

  test('사용량 문구는 usage_limit', () => {
    expect(classifySummaryError(runError({ stdout: 'Usage limit reached' })).reason).toBe(
      'usage_limit'
    )
    expect(classifySummaryError(runError({ stderr: 'Credit balance too low' })).reason).toBe(
      'usage_limit'
    )
  })

  test('타임아웃은 출력이 비어 있어도 timeout으로 가른다', () => {
    const f = classifySummaryError(timedOut())
    expect(f.reason).toBe('timeout')
    expect(f.detail).toContain('제한 시간')
  })

  test('JSON 파싱 실패는 invalid_output이고 응답 원문을 남긴다', () => {
    const f = classifySummaryError(new InvalidOutputError('죄송합니다. 요약을 만들 수 없었습니다.'))
    expect(f.reason).toBe('invalid_output')
    expect(f.detail).toContain('요약을 만들 수 없었습니다')
  })

  test('매칭되지 않으면 unknown이고 원문을 그대로 보존한다', () => {
    const f = classifySummaryError(runError({ stderr: 'error: unknown option' }))
    expect(f.reason).toBe('unknown')
    expect(f.detail).toContain('error: unknown option')
  })
})

describe('classifySummaryError — 오분류 방지', () => {
  // 분류기가 아무 Error나 받으면 회의록 파일 부재·git 미설치의 ENOENT까지 "claude 미설치"로
  // 오진단한다. 사용자는 멀쩡한 CLI를 재설치하러 간다 — 원인 미상보다 나쁘다.
  test('ClaudeRunError가 아닌 ENOENT는 미설치로 오진단하지 않는다', () => {
    const ioError = Object.assign(new Error("ENOENT: no such file or directory, open 'a.md'"), {
      code: 'ENOENT'
    })
    const f = classifySummaryError(ioError)
    expect(f.reason).toBe('unknown')
    expect(f.detail).toContain('no such file')
  })

  test('Error가 아닌 값도 unknown으로 흡수한다', () => {
    expect(classifySummaryError('그냥 문자열').reason).toBe('unknown')
  })

  // 모델이 생성한 텍스트가 키워드 검사에 섞이면 회의 주제가 오분류를 유발한다.
  // 미탐은 unknown 폴백이 흡수하지만 오탐은 흡수되지 않는다(틀린 확신을 준다).
  test('긴 모델 출력에 authentication이 섞여도 미인증으로 오분류하지 않는다', () => {
    const modelText = '이번 회의에서는 authentication 플로우를 논의했다. '.repeat(20)
    expect(classifySummaryError(runError({ stdout: modelText })).reason).toBe('unknown')
  })

  test('긴 모델 출력의 rate limit도 사용량 한도로 오분류하지 않는다', () => {
    const modelText = 'API rate limit 정책을 어떻게 설계할지 검토했다. '.repeat(20)
    expect(classifySummaryError(runError({ stdout: modelText })).reason).toBe('unknown')
  })

  test('JSON 출력은 키워드 검사에서 제외한다', () => {
    const json = JSON.stringify({ summary: 'authentication 설계 회의', sections: {} })
    expect(classifySummaryError(runError({ stdout: json })).reason).toBe('unknown')
  })

  // claude는 JSON을 ``` 펜스로 감싸 내놓기도 한다(parseClaudeOutput이 펜스 정규식을 갖고 있다).
  // 펜스를 못 걸러내면 짧은 요약 본문의 'rate limit'이 사용량 한도로 오분류된다.
  test('펜스로 감싼 JSON도 키워드 검사에서 제외한다', () => {
    const fenced = '```json\n{"summary": "API rate limit 정책 확정", "sections": {}}\n```'
    expect(fenced.length).toBeLessThan(400) // 길이 필터가 아니라 펜스 인식으로 걸러야 한다
    expect(classifySummaryError(runError({ stdout: fenced })).reason).toBe('unknown')
  })

  test('펜스 JSON에 authentication이 있어도 미인증으로 오분류하지 않는다', () => {
    const fenced = '```json\n{"summary": "authentication 모듈 설계", "sections": {}}\n```'
    expect(classifySummaryError(runError({ stdout: fenced })).reason).toBe('unknown')
  })

  // 범용 단어를 키워드에 넣으면 사내 프록시의 407이 "Claude 로그인하세요"로 오분류된다.
  test('프록시 인증 요구는 미인증으로 오분류하지 않는다', () => {
    expect(classifySummaryError(runError({ stderr: 'proxy authentication required' })).reason).toBe(
      'unknown'
    )
    expect(classifySummaryError(runError({ stderr: '401 Unauthorized' })).reason).toBe('unknown')
  })

  test('짧은 CLI 진단은 stdout에 있어도 계속 판정한다', () => {
    expect(
      classifySummaryError(runError({ stdout: 'Not logged in · Please run /login' })).reason
    ).toBe('not_authenticated')
  })

  // 길이 경계를 고정한다 — DIAGNOSTIC_MAX가 바뀌면 이 테스트가 알려준다.
  test('진단 길이 경계(400자) 전후로 판정이 갈린다', () => {
    const under = `Not logged in ${'가'.repeat(380)}`
    const over = `Not logged in ${'가'.repeat(400)}`
    expect(under.length).toBeLessThanOrEqual(400)
    expect(over.length).toBeGreaterThan(400)
    expect(classifySummaryError(runError({ stdout: under })).reason).toBe('not_authenticated')
    expect(classifySummaryError(runError({ stdout: over })).reason).toBe('unknown')
  })
})

describe('classifySummaryError — detail 생성', () => {
  test('프롬프트 전문을 담지 않는다', () => {
    const f = classifySummaryError(runError({ stdout: 'Not logged in' }))
    expect(f.detail).not.toContain('Command failed')
    expect(f.detail).not.toContain('-p')
  })

  test('stdout·stderr에 서로 다른 정보가 있으면 둘 다 담는다', () => {
    const f = classifySummaryError(runError({ stdout: '출력쪽 내용', stderr: '오류쪽 내용' }))
    expect(f.detail).toContain('출력쪽 내용')
    expect(f.detail).toContain('오류쪽 내용')
  })

  test('출력이 전혀 없으면 exit code를 알려준다', () => {
    expect(classifySummaryError(runError({ exitCode: 7 })).detail).toContain('exit code 7')
  })

  test('길면 앞뒤를 남기고 잘렸음을 알린다', () => {
    const long = `머리말${'가'.repeat(2000)}진짜원인은맨뒤에있다`
    const f = classifySummaryError(runError({ stdout: long }))
    expect(f.detail).toContain('일부 생략')
    expect(f.detail).toContain('머리말')
    // 앞만 자르면 끝에 있는 원인이 통째로 사라진다.
    expect(f.detail).toContain('진짜원인은맨뒤에있다')
    expect(f.detail.length).toBeLessThan(long.length)
  })

  // 합친 뒤 한 번에 자르면 뒤 스트림의 라벨이 생략 구간에 묻혀 출처를 알 수 없다.
  test('스트림별로 잘라 라벨을 보존한다', () => {
    const f = classifySummaryError(
      runError({ stdout: '가'.repeat(2000), stderr: '나'.repeat(2000) })
    )
    expect(f.detail).toContain('[출력]')
    expect(f.detail).toContain('[오류]')
  })

  test('시그널로 죽으면 어떤 시그널인지 알려준다', () => {
    const f = classifySummaryError(runError({ exitCode: null, signal: 'SIGKILL' }))
    expect(f.detail).toContain('SIGKILL')
  })

  test('오류 코드가 있으면 노출한다(maxBuffer 초과 등)', () => {
    const f = classifySummaryError(
      runError({ exitCode: null, errorCode: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
    )
    expect(f.detail).toContain('ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
  })

  test('입력 전달 실패는 요약이 일부만 반영됐을 수 있음을 알린다', () => {
    const f = classifySummaryError(runError({ exitCode: 0, stdinFailed: true }))
    expect(f.detail).toContain('끝까지 전달하지 못했습니다')
  })

  test('타임아웃 메시지는 실제 적용된 제한 시간을 쓴다', () => {
    expect(classifySummaryError(timedOut({ timeoutMs: 60_000 })).detail).toContain('60초')
  })
})

describe('classifySummaryError — 로깅', () => {
  test('ClaudeRunError는 signal·errorCode까지 남긴다', () => {
    classifySummaryError(runError({ exitCode: null, signal: 'SIGKILL' }))
    expect(console.error).toHaveBeenCalledWith(
      '[summary] 요약 실패',
      expect.objectContaining({ reason: 'unknown', signal: 'SIGKILL' })
    )
  })

  // 로깅이 ClaudeRunError 분기에만 있으면, 원문 없이는 판단 불가한 invalid_output이 무기록으로 남는다.
  test('invalid_output도 응답 원문을 남긴다', () => {
    classifySummaryError(new InvalidOutputError('사과문과 깨진 JSON'))
    expect(console.error).toHaveBeenCalledWith(
      '[summary] 요약 실패',
      expect.objectContaining({ reason: 'invalid_output', raw: expect.stringContaining('사과문') })
    )
  })

  test('예상 밖 예외는 스택을 남긴다', () => {
    classifySummaryError(new TypeError('예상 밖'))
    expect(console.error).toHaveBeenCalledWith(
      '[summary] 요약 실패',
      expect.objectContaining({ reason: 'unknown', stack: expect.stringContaining('TypeError') })
    )
  })

  // maxBuffer가 64MB이므로 전문을 그대로 덤프하면 main 프로세스가 동기 write로 멈춘다.
  test('거대한 출력은 로그에서도 잘라낸다', () => {
    classifySummaryError(runError({ stdout: 'x'.repeat(50_000) }))
    const [, context] = vi.mocked(console.error).mock.calls[0] as [string, { stdout: string }]
    expect(context.stdout.length).toBeLessThan(10_000)
  })
})
