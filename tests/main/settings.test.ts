import { describe, expect, test } from 'vitest'
import { loadSettings, migrateLegacySettings, minitHome, saveSettings } from '../../src/main/settings'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('loadSettings', () => {
  test('missing file: creates settings.json and returns defaults', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      const result = loadSettings(tempDir, '/default-repo')
      expect(result).toEqual({
        repoRoot: '/default-repo',
        modelName: 'ggml-large-v3-turbo.bin',
        autoPush: true,
        slackChannelId: null,
        slackChannelName: null,
        slackPromptShown: false,
        slackAutoSend: false,
        githubRepo: null,
        githubPromptShown: false,
        githubSync: false,
        pendingUploads: [],
        pendingDeletes: [],
      })
      const written = JSON.parse(fs.readFileSync(path.join(tempDir, 'settings.json'), 'utf-8'))
      expect(written).toEqual({
        repoRoot: '/default-repo',
        modelName: 'ggml-large-v3-turbo.bin',
        autoPush: true,
        slackChannelId: null,
        slackChannelName: null,
        slackPromptShown: false,
        slackAutoSend: false,
        githubRepo: null,
        githubPromptShown: false,
        githubSync: false,
        pendingUploads: [],
        pendingDeletes: [],
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('valid file: returns merged settings and does not overwrite file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      const customSettings = { repoRoot: '/custom-repo' }
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify(customSettings, null, 2)
      )
      const originalMtime = fs.statSync(path.join(tempDir, 'settings.json')).mtime.getTime()

      // Small delay to ensure mtime would be different if file was rewritten
      const result = loadSettings(tempDir, '/default-repo')

      expect(result).toEqual({
        repoRoot: '/custom-repo',
        modelName: 'ggml-large-v3-turbo.bin',
        autoPush: true,
        slackChannelId: null,
        slackChannelName: null,
        slackPromptShown: false,
        slackAutoSend: false,
        githubRepo: null,
        githubPromptShown: false,
        githubSync: false,
        pendingUploads: [],
        pendingDeletes: [],
      })
      const currentMtime = fs.statSync(path.join(tempDir, 'settings.json')).mtime.getTime()
      expect(currentMtime).toBe(originalMtime)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('corrupt file: returns defaults, original preserved in .bak, valid defaults written', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      const corruptContent = '{oops'
      fs.writeFileSync(path.join(tempDir, 'settings.json'), corruptContent)

      const result = loadSettings(tempDir, '/default-repo')

      expect(result).toEqual({
        repoRoot: '/default-repo',
        modelName: 'ggml-large-v3-turbo.bin',
        autoPush: true,
        slackChannelId: null,
        slackChannelName: null,
        slackPromptShown: false,
        slackAutoSend: false,
        githubRepo: null,
        githubPromptShown: false,
        githubSync: false,
        pendingUploads: [],
        pendingDeletes: [],
      })

      // Original should be in .bak
      const bakContent = fs.readFileSync(path.join(tempDir, 'settings.json.bak'), 'utf-8')
      expect(bakContent).toBe(corruptContent)

      // New file should contain valid defaults
      const newContent = JSON.parse(fs.readFileSync(path.join(tempDir, 'settings.json'), 'utf-8'))
      expect(newContent).toEqual({
        repoRoot: '/default-repo',
        modelName: 'ggml-large-v3-turbo.bin',
        autoPush: true,
        slackChannelId: null,
        slackChannelName: null,
        slackPromptShown: false,
        slackAutoSend: false,
        githubRepo: null,
        githubPromptShown: false,
        githubSync: false,
        pendingUploads: [],
        pendingDeletes: [],
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('corrupt file with existing .bak: overwrites .bak', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      const oldBakContent = 'old backup'
      fs.writeFileSync(path.join(tempDir, 'settings.json.bak'), oldBakContent)

      const corruptContent = '{new-corrupt'
      fs.writeFileSync(path.join(tempDir, 'settings.json'), corruptContent)

      loadSettings(tempDir, '/default-repo')

      const bakContent = fs.readFileSync(path.join(tempDir, 'settings.json.bak'), 'utf-8')
      expect(bakContent).toBe(corruptContent)
      expect(bakContent).not.toBe(oldBakContent)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('defaults modelName applied to valid file missing modelName', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      const partialSettings = { repoRoot: '/custom-repo' }
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify(partialSettings, null, 2)
      )

      const result = loadSettings(tempDir, '/default-repo')

      expect(result).toEqual({
        repoRoot: '/custom-repo',
        modelName: 'ggml-large-v3-turbo.bin',
        autoPush: true,
        slackChannelId: null,
        slackChannelName: null,
        slackPromptShown: false,
        slackAutoSend: false,
        githubRepo: null,
        githubPromptShown: false,
        githubSync: false,
        pendingUploads: [],
        pendingDeletes: [],
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('autoPush 기본값은 true다 (기존 settings.json에 키가 없어도 병합으로 true가 된다)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo' }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.autoPush).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('slackChannelId·slackChannelName 기본값은 null, slackPromptShown 기본값은 false다 (기존 settings.json에 키가 없어도 병합된다)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo' }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.slackChannelId).toBeNull()
      expect(result.slackChannelName).toBeNull()
      expect(result.slackPromptShown).toBe(false)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('slackChannelId·slackChannelName·slackPromptShown이 저장된 값이 있으면 그대로 병합된다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify(
          { repoRoot: '/custom-repo', slackChannelId: 'C123', slackChannelName: '#회의록', slackPromptShown: true },
          null,
          2
        )
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.slackChannelId).toBe('C123')
      expect(result.slackChannelName).toBe('#회의록')
      expect(result.slackPromptShown).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('v0.3.x가 남긴 평문 slackBotToken·slackChannel은 로드 시 제거된다(재저장하지 않음 — slack-token-store 이관은 별도 함수 책임)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', slackBotToken: 'xoxb-legacy', slackChannel: '#회의록' }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result).not.toHaveProperty('slackBotToken')
      expect(result).not.toHaveProperty('slackChannel')
      expect(result.slackChannelId).toBeNull()
      expect(result.slackChannelName).toBeNull()
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('githubRepo 기본값은 null, githubPromptShown 기본값은 false, pendingUploads 기본값은 빈 배열이다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo' }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.githubRepo).toBeNull()
      expect(result.githubPromptShown).toBe(false)
      expect(result.pendingUploads).toEqual([])
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('githubRepo·githubPromptShown·pendingUploads가 저장된 값이 있으면 그대로 병합된다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify(
          {
            repoRoot: '/custom-repo',
            githubRepo: 'git-artinus/minit',
            githubPromptShown: true,
            pendingUploads: ['2026-07-22-회의.md'],
          },
          null,
          2
        )
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.githubRepo).toBe('git-artinus/minit')
      expect(result.githubPromptShown).toBe(true)
      expect(result.pendingUploads).toEqual(['2026-07-22-회의.md'])
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('pendingDeletes 기본값은 빈 배열이고, 저장된 값이 있으면 그대로 병합된다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      const file = path.join(tempDir, 'settings.json')
      fs.writeFileSync(file, JSON.stringify({ repoRoot: '/custom-repo' }, null, 2))
      expect(loadSettings(tempDir, '/default-repo').pendingDeletes).toEqual([])

      fs.writeFileSync(
        file,
        JSON.stringify({ repoRoot: '/custom-repo', pendingDeletes: ['2026-07-22-회의.md'] }, null, 2)
      )
      expect(loadSettings(tempDir, '/default-repo').pendingDeletes).toEqual(['2026-07-22-회의.md'])
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('githubSync 기본값은 false다(기존 settings.json에 키가 없어도 병합된다)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo' }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.githubSync).toBe(false)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('githubSync가 저장된 값이 있으면 그대로 병합된다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', githubSync: true }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.githubSync).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })
})

describe('loadSettings slackAutoSend 마이그레이션', () => {
  test('필드가 없고 채널이 선택돼 있으면 true로 이어받는다(도입 이전 "채널 선택 = 자동 발송" 보존)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', slackChannelId: 'C123', slackChannelName: '#회의록' }, null, 2)
      )
      expect(loadSettings(tempDir, '/default-repo').slackAutoSend).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('필드가 없고 채널도 없으면 false다(신규 사용자 기본값)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo' }, null, 2)
      )
      expect(loadSettings(tempDir, '/default-repo').slackAutoSend).toBe(false)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('저장된 boolean 값이 있으면 채널 유무와 무관하게 그대로 쓴다(false 명시 존중)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify(
          { repoRoot: '/custom-repo', slackChannelId: 'C123', slackChannelName: '#회의록', slackAutoSend: false },
          null,
          2
        )
      )
      expect(loadSettings(tempDir, '/default-repo').slackAutoSend).toBe(false)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('boolean이 아닌 손상 값이면 채널 유무를 기준으로 재유도한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', slackChannelId: 'C123', slackAutoSend: 'yes' }, null, 2)
      )
      expect(loadSettings(tempDir, '/default-repo').slackAutoSend).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })
})

describe('loadSettings 방어적 정규화(손상된 값)', () => {
  test('pendingUploads가 배열이 아니면 빈 배열로 정규화한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', pendingUploads: 'not-an-array' }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.pendingUploads).toEqual([])
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('pendingUploads 배열에 문자열이 아닌 원소가 섞여 있으면 빈 배열로 정규화한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', pendingUploads: ['a.md', 123, null] }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.pendingUploads).toEqual([])
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('pendingDeletes가 문자열 배열이 아니면 빈 배열로 정규화한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', pendingDeletes: ['a.md', 7] }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.pendingDeletes).toEqual([])
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('slackChannelId가 문자열·null이 아니면 null로 정규화한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', slackChannelId: 12345 }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.slackChannelId).toBeNull()
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('slackChannelName이 문자열·null이 아니면 null로 정규화한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', slackChannelName: 12345 }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.slackChannelName).toBeNull()
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('githubSync가 boolean이 아니면 기본값(false)으로 정규화한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', githubSync: 'yes' }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.githubSync).toBe(false)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('githubRepo가 문자열·null이 아니면 null로 정규화한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', githubRepo: { owner: 'x', repo: 'y' } }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.githubRepo).toBeNull()
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('autoPush가 boolean이 아니면 기본값(true)으로 정규화한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify({ repoRoot: '/custom-repo', autoPush: 'yes' }, null, 2)
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.autoPush).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('slackPromptShown·githubPromptShown이 boolean이 아니면 기본값(false)으로 정규화한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify(
          { repoRoot: '/custom-repo', slackPromptShown: null, githubPromptShown: 1 },
          null,
          2
        )
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.slackPromptShown).toBe(false)
      expect(result.githubPromptShown).toBe(false)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('유효한 값은 정규화로 훼손되지 않고 그대로 유지된다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(
        path.join(tempDir, 'settings.json'),
        JSON.stringify(
          {
            repoRoot: '/custom-repo',
            pendingUploads: ['2026-07-22-회의.md'],
            slackChannelId: 'C123',
            slackChannelName: '#회의록',
            githubRepo: 'git-artinus/minit',
            autoPush: false,
            githubSync: true,
            slackPromptShown: true,
            githubPromptShown: true
          },
          null,
          2
        )
      )
      const result = loadSettings(tempDir, '/default-repo')
      expect(result.pendingUploads).toEqual(['2026-07-22-회의.md'])
      expect(result.slackChannelId).toBe('C123')
      expect(result.slackChannelName).toBe('#회의록')
      expect(result.githubRepo).toBe('git-artinus/minit')
      expect(result.autoPush).toBe(false)
      expect(result.githubSync).toBe(true)
      expect(result.slackPromptShown).toBe(true)
      expect(result.githubPromptShown).toBe(true)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })
})

describe('saveSettings', () => {
  test('saveSettings → loadSettings 왕복: autoPush false를 저장하면 그대로 복원된다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      const toSave = {
        repoRoot: '/custom-repo',
        modelName: 'ggml-large-v3-turbo.bin',
        autoPush: false,
        slackChannelId: 'C123',
        slackChannelName: '#회의록',
        slackPromptShown: true,
        // 채널이 있어도 명시적 false는 마이그레이션이 덮지 않는다(왕복 보존 확인).
        slackAutoSend: false,
        githubRepo: null,
        githubPromptShown: false,
        githubSync: false,
        pendingUploads: [],
        pendingDeletes: [],
      }
      saveSettings(tempDir, toSave)

      const result = loadSettings(tempDir, '/default-repo')
      expect(result).toEqual(toSave)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('userDataDir가 없으면 생성 후 기록한다', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    const nested = path.join(parent, 'nested', 'dir')
    try {
      saveSettings(nested, {
        repoRoot: '/r',
        modelName: 'm',
        autoPush: false,
        slackChannelId: null,
        slackChannelName: null,
        slackPromptShown: false,
        slackAutoSend: false,
        githubRepo: null,
        githubPromptShown: false,
        githubSync: false,
        pendingUploads: [],
        pendingDeletes: [],
      })
      const written = JSON.parse(fs.readFileSync(path.join(nested, 'settings.json'), 'utf-8'))
      expect(written).toEqual({
        repoRoot: '/r',
        modelName: 'm',
        autoPush: false,
        slackChannelId: null,
        slackChannelName: null,
        slackPromptShown: false,
        slackAutoSend: false,
        githubRepo: null,
        githubPromptShown: false,
        githubSync: false,
        pendingUploads: [],
        pendingDeletes: [],
      })
    } finally {
      fs.rmSync(parent, { recursive: true })
    }
  })
})

describe('saveSettings 필드 보존(리뷰 Fix 1)', () => {
  test('디스크에 남아있는 미이관 레거시 평문 필드(slackBotToken)를 보존한 채 병합 저장한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      const onDisk = {
        repoRoot: '/custom-repo',
        modelName: 'ggml-large-v3-turbo.bin',
        autoPush: true,
        slackChannelId: null,
        slackChannelName: null,
        slackPromptShown: false,
        slackAutoSend: false,
        githubRepo: null,
        githubPromptShown: false,
        githubSync: false,
        pendingUploads: [],
        pendingDeletes: [],
        // safeStorage 미가용으로 아직 암호화 저장소로 이관되지 못한 v0.3.x 평문 잔존 필드
        slackBotToken: 'xoxb-legacy-unmigrated',
      }
      fs.writeFileSync(path.join(tempDir, 'settings.json'), JSON.stringify(onDisk, null, 2))

      // loadSettings는 메모리 표현에서 slackBotToken을 버린다(정상 동작) — 디스크는 그대로다.
      const loaded = loadSettings(tempDir, '/default-repo')
      expect(loaded).not.toHaveProperty('slackBotToken')

      // 마이그레이션과 무관한 다른 설정 변경(예: autoPush 토글) 경로로 saveSettings가 호출돼도
      // 디스크의 미이관 평문 필드가 통째로 사라지면 안 된다.
      saveSettings(tempDir, { ...loaded, autoPush: false })

      const raw = JSON.parse(fs.readFileSync(path.join(tempDir, 'settings.json'), 'utf-8'))
      expect(raw.slackBotToken).toBe('xoxb-legacy-unmigrated')
      expect(raw.autoPush).toBe(false)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('디스크 파일이 없으면 병합 없이 settings만으로 새로 쓴다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      saveSettings(tempDir, {
        repoRoot: '/r', modelName: 'm', autoPush: true,
        slackChannelId: null, slackChannelName: null, slackPromptShown: false, slackAutoSend: false,
        githubRepo: null, githubPromptShown: false, githubSync: false, pendingUploads: [], pendingDeletes: [],
      })
      const raw = JSON.parse(fs.readFileSync(path.join(tempDir, 'settings.json'), 'utf-8'))
      expect(Object.keys(raw).sort()).toEqual(
        [
          'repoRoot', 'modelName', 'autoPush', 'slackChannelId', 'slackChannelName',
          'slackPromptShown', 'slackAutoSend', 'githubRepo', 'githubPromptShown', 'githubSync',
          'pendingUploads', 'pendingDeletes',
        ].sort()
      )
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('디스크 파일이 손상된 JSON이면 병합 없이 settings만으로 덮어쓴다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-settings-'))
    try {
      fs.writeFileSync(path.join(tempDir, 'settings.json'), '{broken')
      saveSettings(tempDir, {
        repoRoot: '/r', modelName: 'm', autoPush: true,
        slackChannelId: null, slackChannelName: null, slackPromptShown: false, slackAutoSend: false,
        githubRepo: null, githubPromptShown: false, githubSync: false, pendingUploads: [], pendingDeletes: [],
      })
      const raw = JSON.parse(fs.readFileSync(path.join(tempDir, 'settings.json'), 'utf-8'))
      expect(raw.repoRoot).toBe('/r')
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })
})

describe('minitHome', () => {
  test('os.homedir()/.minit 를 반환한다', () => {
    expect(minitHome()).toBe(path.join(os.homedir(), '.minit'))
  })
})

describe('migrateLegacySettings', () => {
  test('레거시 위치에 settings.json이 있고 새 위치에 없으면 새 위치로 복사한다', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-legacy-'))
    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-new-'))
    fs.rmSync(newDir, { recursive: true }) // 새 위치는 아직 존재하지 않는 상태를 재현
    try {
      // repoRoot는 실존하는 경로여야 "존재하지 않으면 minitHome()으로 치환" 로직이 타지 않는다.
      const legacyContent = { repoRoot: legacyDir, modelName: 'ggml-large-v3-turbo.bin', autoPush: true }
      fs.writeFileSync(path.join(legacyDir, 'settings.json'), JSON.stringify(legacyContent, null, 2))

      migrateLegacySettings(legacyDir, newDir)

      const migrated = JSON.parse(fs.readFileSync(path.join(newDir, 'settings.json'), 'utf-8'))
      expect(migrated).toEqual(legacyContent)
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true })
      fs.rmSync(newDir, { recursive: true, force: true })
    }
  })

  test('레거시 repoRoot가 존재하지 않는 경로면 minitHome()으로 치환해서 이관한다', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-legacy-'))
    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-new-'))
    fs.rmSync(newDir, { recursive: true })
    try {
      const legacyContent = {
        repoRoot: '/no-such-dir-for-minit-test-xyz',
        modelName: 'ggml-large-v3-turbo.bin',
        autoPush: false,
      }
      fs.writeFileSync(path.join(legacyDir, 'settings.json'), JSON.stringify(legacyContent, null, 2))

      migrateLegacySettings(legacyDir, newDir)

      const migrated = JSON.parse(fs.readFileSync(path.join(newDir, 'settings.json'), 'utf-8'))
      expect(migrated).toEqual({ ...legacyContent, repoRoot: minitHome() })
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true })
      fs.rmSync(newDir, { recursive: true, force: true })
    }
  })

  test('레거시 위치에 settings.json이 없으면 아무 일도 하지 않는다', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-legacy-'))
    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-new-'))
    fs.rmSync(newDir, { recursive: true })
    try {
      migrateLegacySettings(legacyDir, newDir)
      expect(fs.existsSync(newDir)).toBe(false)
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true })
      fs.rmSync(newDir, { recursive: true, force: true })
    }
  })

  test('새 위치에 이미 settings.json이 있으면 덮어쓰지 않는다', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-legacy-'))
    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-new-'))
    try {
      fs.writeFileSync(path.join(legacyDir, 'settings.json'), JSON.stringify({ repoRoot: '/legacy-repo' }))
      const existingContent = { repoRoot: '/already-here', modelName: 'ggml-large-v3-turbo.bin', autoPush: false }
      fs.writeFileSync(path.join(newDir, 'settings.json'), JSON.stringify(existingContent, null, 2))

      migrateLegacySettings(legacyDir, newDir)

      const result = JSON.parse(fs.readFileSync(path.join(newDir, 'settings.json'), 'utf-8'))
      expect(result).toEqual(existingContent)
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true })
      fs.rmSync(newDir, { recursive: true, force: true })
    }
  })
})
