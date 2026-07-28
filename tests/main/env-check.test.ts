import { describe, expect, test, vi } from 'vitest'
import { bundledWhisperPath, checkEnv, modelFilePath, resolveWhisperCli } from '../../src/main/env-check'

test('modelFilePath: userData/models 하위 경로', () => {
  expect(modelFilePath('/ud', 'ggml-large-v3-turbo.bin')).toBe('/ud/models/ggml-large-v3-turbo.bin')
})

test('bundledWhisperPath: appRoot/resources/bin/whisper-cli', () => {
  expect(bundledWhisperPath('/app')).toBe('/app/resources/bin/whisper-cli')
})

describe('resolveWhisperCli', () => {
  test('번들 바이너리(resources/bin)가 있으면 그 절대경로를 우선 반환한다', async () => {
    const result = await resolveWhisperCli({
      appRoot: '/app',
      fileExists: (p) => p === '/app/resources/bin/whisper-cli',
      commandExists: async () => true, // PATH에도 있어도 번들이 우선이어야 한다
    })
    expect(result).toBe('/app/resources/bin/whisper-cli')
  })

  test('packaged 후보(appRoot/bin/whisper-cli)도 확인한다', async () => {
    const result = await resolveWhisperCli({
      appRoot: '/Contents/Resources',
      fileExists: (p) => p === '/Contents/Resources/bin/whisper-cli',
      commandExists: async () => false,
    })
    expect(result).toBe('/Contents/Resources/bin/whisper-cli')
  })

  test('번들이 없으면 PATH의 whisper-cli로 폴백한다', async () => {
    const result = await resolveWhisperCli({
      appRoot: '/app',
      fileExists: () => false,
      commandExists: async (cmd) => cmd === 'whisper-cli',
    })
    expect(result).toBe('whisper-cli')
  })

  test('번들도 PATH도 없으면 null을 반환한다', async () => {
    const result = await resolveWhisperCli({
      appRoot: '/app',
      fileExists: () => false,
      commandExists: async () => false,
    })
    expect(result).toBeNull()
  })
})

describe('checkEnv', () => {
  test('도구 존재 여부를 EnvReport로 집계한다 (whisper는 resolveWhisperCli 결과 기반)', async () => {
    const report = await checkEnv({
      commandExists: async (cmd) => cmd !== 'whisper-cli',
      modelPath: '/ud/models/x.bin',
      repoRoot: '/repo',
      appRoot: '/app',
      fileExists: (p) => p === '/ud/models/x.bin',
    })
    expect(report).toEqual({ git: true, whisper: false, model: true, repoRoot: '/repo' })
  })

  // claude 가용성은 ClaudeStatus만 말한다(#8) — which 결과를 여기에 같이 실으면 화면이
  // "설치됨"을 "쓸 수 있음"으로 읽는 길이 다시 열린다.
  test('claude는 검사하지 않는다', async () => {
    const commandExists = vi.fn().mockImplementation(async (cmd: string) => cmd !== 'whisper-cli')
    const report = await checkEnv({
      commandExists,
      modelPath: '/ud/models/x.bin',
      repoRoot: '/repo',
      appRoot: '/app',
      fileExists: (p) => p === '/ud/models/x.bin',
    })
    expect(commandExists).not.toHaveBeenCalledWith('claude')
    expect(report).not.toHaveProperty('claude')
  })

  test('번들 바이너리가 있으면 PATH에 없어도 whisper: true', async () => {
    const report = await checkEnv({
      commandExists: async () => false,
      modelPath: '/ud/models/x.bin',
      repoRoot: '/repo',
      appRoot: '/app',
      fileExists: (p) => p === '/ud/models/x.bin' || p === '/app/resources/bin/whisper-cli',
    })
    expect(report.whisper).toBe(true)
  })
})
