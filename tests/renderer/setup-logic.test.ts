import { describe, expect, test } from 'vitest'
import { deriveSetupState, isEnvReady } from '../../src/renderer/src/state/setup-logic'
import type { EnvReport } from '../../src/shared/types'

function env(partial: Partial<EnvReport>): EnvReport {
  return { git: true, claude: true, whisper: true, model: true, repoRoot: '/tmp', ...partial }
}

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
  test('whisper·model 모두 있으면 true', () => {
    expect(isEnvReady(env({ whisper: true, model: true }))).toBe(true)
  })
})

describe('deriveSetupState', () => {
  test('env를 아직 확인하지 못했으면 checking', () => {
    expect(deriveSetupState(null, null, null)).toEqual({ kind: 'checking' })
  })

  test('whisper가 없으면 model 상태와 무관하게 unsupported', () => {
    expect(deriveSetupState(env({ whisper: false, model: false }), null, null)).toEqual({
      kind: 'unsupported'
    })
    expect(deriveSetupState(env({ whisper: false, model: true }), null, null)).toEqual({
      kind: 'unsupported'
    })
  })

  test('whisper·model 모두 준비되면 hidden(패널 미렌더)', () => {
    expect(deriveSetupState(env({ whisper: true, model: true }), null, null)).toEqual({
      kind: 'hidden'
    })
  })

  test('model이 없고 오류가 있으면 error가 progress보다 우선한다', () => {
    expect(
      deriveSetupState(env({ whisper: true, model: false }), { received: 10, total: 100 }, '실패')
    ).toEqual({ kind: 'error', message: '실패' })
  })

  test('model이 없고 진행 중이면 downloading', () => {
    expect(
      deriveSetupState(env({ whisper: true, model: false }), { received: 10, total: 100 }, null)
    ).toEqual({ kind: 'downloading', progress: { received: 10, total: 100 } })
  })

  test('model이 없고 오류·진행 모두 없으면 needs-model', () => {
    expect(deriveSetupState(env({ whisper: true, model: false }), null, null)).toEqual({
      kind: 'needs-model'
    })
  })
})
