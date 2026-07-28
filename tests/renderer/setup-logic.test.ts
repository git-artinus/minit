import { describe, expect, test } from 'vitest'
import { deriveSetupState, isEnvReady } from '../../src/renderer/src/state/setup-logic'
import type { ClaudeStatus, EnvReport, SummaryFailureReason } from '../../src/shared/types'

function env(partial: Partial<EnvReport>): EnvReport {
  return { git: true, whisper: true, model: true, repoRoot: '/tmp', ...partial }
}

function unavailable(reason: SummaryFailureReason): ClaudeStatus {
  return { ok: false, failure: { reason, detail: '원인 원문' } }
}

const READY: ClaudeStatus = { ok: true }

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
