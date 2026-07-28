import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ClaudeRunError } from '../../../src/main/pipeline/claude-run'
import { classifySummaryError } from '../../../src/main/pipeline/summary-error'
import { InvalidOutputError } from '../../../src/main/pipeline/summarizer'

// classifySummaryError는 절단 전 전문을 console.error로 남긴다(원인 영구 소실 방지). 출력만 죽인다.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function runError(
  over: Partial<{
    stdout: string
    stderr: string
    exitCode: number | null
    spawnCode: string | null
    timedOut: boolean
  }> = {}
): ClaudeRunError {
  return new ClaudeRunError(
    over.stdout ?? '',
    over.stderr ?? '',
    over.exitCode === undefined ? 1 : over.exitCode,
    over.spawnCode ?? null,
    over.timedOut ?? false
  )
}

describe('classifySummaryError — 사유 판정', () => {
  test('spawn ENOENT는 미설치', () => {
    expect(classifySummaryError(runError({ spawnCode: 'ENOENT', exitCode: null })).reason).toBe(
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
    const f = classifySummaryError(runError({ timedOut: true, exitCode: null }))
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

  test('짧은 CLI 진단은 stdout에 있어도 계속 판정한다', () => {
    expect(
      classifySummaryError(runError({ stdout: 'Not logged in · Please run /login' })).reason
    ).toBe('not_authenticated')
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

  test('exitCode가 있으면 실어 보낸다', () => {
    expect(classifySummaryError(runError({ exitCode: 1, stdout: 'x' })).exitCode).toBe(1)
    expect(
      classifySummaryError(runError({ exitCode: null, timedOut: true })).exitCode
    ).toBeUndefined()
  })

  test('절단 전 전문을 로그로 남긴다', () => {
    classifySummaryError(runError({ stdout: 'Not logged in' }))
    expect(console.error).toHaveBeenCalledWith(
      '[summary] 요약 실패',
      expect.objectContaining({
        reason: 'not_authenticated'
      })
    )
  })
})
