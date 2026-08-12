import { describe, expect, test } from 'vitest'
import {
  appendInstallLog,
  deriveSetupState,
  INSTALL_LOG_MAX_CHARS,
  INSTALL_LOG_MAX_LINES,
  isEnvReady
} from '../../src/renderer/src/state/setup-logic'
import type { ClaudeStatus, EnvReport, SummaryFailureReason } from '../../src/shared/types'

function env(partial: Partial<EnvReport>): EnvReport {
  return { git: true, whisper: true, model: true, repoRoot: '/tmp', ...partial }
}

function unavailable(reason: SummaryFailureReason): ClaudeStatus {
  return { kind: 'unavailable', failure: { reason, detail: '원인 원문' } }
}

const READY: ClaudeStatus = { kind: 'available' }

describe('isEnvReady', () => {
  test('env를 아직 확인하지 못했으면(null) false', () => {
    expect(isEnvReady(null)).toBe(false)
  })
  test('whisper 없으면 false', () => {
    expect(isEnvReady(env({ whisper: false, model: true }))).toBe(false)
  })
  test('model 없으면 false', () => {
    expect(isEnvReady(env({ whisper: true, model: false }))).toBe(false)
  })
  // claude 가용성은 EnvReport에 아예 없다(#8) — isEnvReady가 그걸 볼 여지를 없앤 것이
  // "claude를 못 써도 회의는 시작된다"는 비차단 보장이다.
  test('whisper·model 모두 있으면 true', () => {
    expect(isEnvReady(env({ whisper: true, model: true }))).toBe(true)
  })
})

describe('deriveSetupState', () => {
  test('env를 아직 확인하지 못했으면 checking', () => {
    expect(deriveSetupState(null, null, null, null)).toEqual({ kind: 'checking' })
  })

  test('whisper가 없으면 model 상태와 무관하게 unsupported', () => {
    expect(deriveSetupState(env({ whisper: false, model: false }), READY, null, null)).toEqual({
      kind: 'unsupported'
    })
    expect(deriveSetupState(env({ whisper: false, model: true }), READY, null, null)).toEqual({
      kind: 'unsupported'
    })
  })

  test('whisper·model·claude 모두 준비되면 hidden(패널 미렌더)', () => {
    expect(deriveSetupState(env({ whisper: true, model: true }), READY, null, null)).toEqual({
      kind: 'hidden'
    })
  })

  test('model이 없고 오류가 있으면 error가 progress보다 우선한다', () => {
    expect(
      deriveSetupState(env({ whisper: true, model: false }), READY, { received: 10, total: 100 }, '실패')
    ).toEqual({ kind: 'error', message: '실패' })
  })

  test('model이 없고 진행 중이면 downloading', () => {
    expect(
      deriveSetupState(env({ whisper: true, model: false }), READY, { received: 10, total: 100 }, null)
    ).toEqual({ kind: 'downloading', progress: { received: 10, total: 100 } })
  })

  test('model이 없고 오류·진행 모두 없으면 needs-model', () => {
    expect(deriveSetupState(env({ whisper: true, model: false }), READY, null, null)).toEqual({
      kind: 'needs-model'
    })
  })

  test('model까지 준비된 뒤 claude를 못 쓰면 사유를 실어 claude-unavailable', () => {
    expect(
      deriveSetupState(env({ whisper: true, model: true }), unavailable('not_installed'), null, null)
    ).toEqual({ kind: 'claude-unavailable', failure: { reason: 'not_installed', detail: '원인 원문' } })
    expect(
      deriveSetupState(env({ whisper: true, model: true }), unavailable('not_authenticated'), null, null)
    ).toEqual({
      kind: 'claude-unavailable',
      failure: { reason: 'not_authenticated', detail: '원인 원문' }
    })
  })

  // 프로브는 claude를 실제로 실행하느라 수 초가 걸린다. 그동안 카드를 띄우면 아무 조치도
  // 필요 없는 안내가 실행할 때마다 깜빡인다.
  test('claude 상태를 아직 모르면(null) 안내하지 않고 hidden', () => {
    expect(deriveSetupState(env({ whisper: true, model: true }), null, null, null)).toEqual({
      kind: 'hidden'
    })
  })

  // 콜드 스타트가 느려 프로브가 한 번 타임아웃한 것으로 세션 내내 경고를 띄우면 안 된다.
  // 사용자가 할 수 있는 일이 없는 상태라 카드는 소음이다(설정 화면이 '확인 실패'로 알린다).
  test('판정을 못 한 상태(undetermined)는 카드를 띄우지 않는다', () => {
    const undetermined: ClaudeStatus = {
      kind: 'undetermined',
      failure: { reason: 'timeout', detail: '원인 원문' }
    }
    expect(deriveSetupState(env({ whisper: true, model: true }), undetermined, null, null)).toEqual({
      kind: 'hidden'
    })
  })

  // claude 안내가 더 급한 안내를 가리지 않아야 한다.
  test('model이 아직 없으면 claude 안내보다 모델 안내가 우선한다', () => {
    expect(
      deriveSetupState(env({ whisper: true, model: false }), unavailable('not_installed'), null, null)
    ).toEqual({ kind: 'needs-model' })
    expect(
      deriveSetupState(
        env({ whisper: true, model: false }),
        unavailable('not_installed'),
        { received: 1, total: 2 },
        null
      )
    ).toEqual({ kind: 'downloading', progress: { received: 1, total: 2 } })
  })

  test('whisper가 없으면 claude 상태와 무관하게 unsupported', () => {
    expect(deriveSetupState(env({ whisper: false }), unavailable('not_installed'), null, null)).toEqual({
      kind: 'unsupported'
    })
  })
})

describe('appendInstallLog — 설치 출력 누적', () => {
  test('청크를 이어 붙인다', () => {
    expect(appendInstallLog('a', 'b')).toBe('ab')
  })

  // 설치 스크립트는 진행률을 줄 단위로 갱신해 수천 줄이 나올 수 있다. 전량을 렌더러 상태에
  // 쌓으면 메모리와 렌더 비용이 계속 커진다 — 전문은 로그 파일에 남으므로 화면은 끝부분만 있으면 된다.
  test('상한을 넘으면 끝부분만 남긴다', () => {
    const many = Array.from({ length: INSTALL_LOG_MAX_LINES + 10 }, (_, i) => `줄 ${i}`).join('\n')
    const kept = appendInstallLog('', many).split('\n')

    expect(kept).toHaveLength(INSTALL_LOG_MAX_LINES)
    // 오래된 줄이 아니라 최신 줄이 남아야 한다 — 실패 원인은 보통 끝에 있다.
    expect(kept.at(-1)).toBe(`줄 ${INSTALL_LOG_MAX_LINES + 9}`)
    expect(kept[0]).not.toBe('줄 0')
  })

  test('상한 이하면 그대로 둔다', () => {
    expect(appendInstallLog('a\n', 'b')).toBe('a\nb')
  })
})

describe('appendInstallLog — 줄바꿈 없는 출력', () => {
  // 진행률을 캐리지 리턴으로 갱신하는 프로그램의 출력은 아무리 길어도 한 줄이다.
  // 줄 수만 세면 상한이 걸리지 않아 화면에 수 MB짜리 한 줄이 쌓인다.
  test('줄바꿈이 없어도 글자 수 상한이 걸린다', () => {
    const oneLongLine = 'x'.repeat(INSTALL_LOG_MAX_CHARS * 2)

    const kept = appendInstallLog('', oneLongLine)

    expect(kept.length).toBeLessThanOrEqual(INSTALL_LOG_MAX_CHARS)
  })

  test('여러 번 이어 붙여도 상한을 넘지 않는다', () => {
    let log = ''
    for (let i = 0; i < 50; i++) log = appendInstallLog(log, '진행률\r'.repeat(200))

    expect(log.length).toBeLessThanOrEqual(INSTALL_LOG_MAX_CHARS)
  })

  // 잘라낼 때 오래된 쪽을 버려야 한다 — 실패 원인은 보통 끝에 있다.
  test('글자 수로 자를 때도 최신 내용이 남는다', () => {
    const kept = appendInstallLog('오래된'.repeat(INSTALL_LOG_MAX_CHARS), '최신 내용')

    expect(kept.endsWith('최신 내용')).toBe(true)
  })
})
