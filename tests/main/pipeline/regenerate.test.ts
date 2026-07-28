import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { serializeMeeting } from '../../../src/shared/meeting-file'
import type { Meeting } from '../../../src/shared/types'
import { ClaudeRunError } from '../../../src/main/pipeline/claude-run'
import { regenerateSummary } from '../../../src/main/pipeline/regenerate'
import { systemGit } from '../../../src/main/pipeline/storage'
import type { RunCommand } from '../../../src/main/pipeline/transcriber'
import type { RegenerateResult } from '../../../src/shared/types'

function recordingGit(): { git: RunCommand; calls: string[][] } {
  const calls: string[][] = []
  const git: RunCommand = async (_cmd, args) => {
    calls.push(args)
    return { stdout: '' }
  }
  return { git, calls }
}

/** ok:true를 단언하고 회의록을 꺼낸다 — 실패하면 원인을 그대로 보여준다. */
function expectOk(result: RegenerateResult): Meeting {
  if (!result.ok) throw new Error(`요약이 실패했다: ${result.failure.reason} / ${result.failure.detail}`)
  return result.meeting
}

function seedRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-regen-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo })
  fs.mkdirSync(path.join(repo, 'meetings'))
  const raw = serializeMeeting({
    meetingType: 'general', title: '회의', date: '2026-07-20T10:00:00+09:00', durationMin: 10, participants: [],
    summary: '', sections: [], segments: [{ startMs: 0, text: '안녕하세요.' }],
  })
  fs.writeFileSync(path.join(repo, 'meetings', 'a.md'), raw)
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: repo })
  return repo
}

function seedNonGitRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-regen-nongit-'))
  fs.mkdirSync(path.join(repo, 'meetings'))
  const raw = serializeMeeting({
    meetingType: 'general', title: '회의', date: '2026-07-20T10:00:00+09:00', durationMin: 10, participants: [],
    summary: '', sections: [], segments: [{ startMs: 0, text: '안녕하세요.' }],
  })
  fs.writeFileSync(path.join(repo, 'meetings', 'a.md'), raw)
  return repo
}

test('요약 없는 회의록에 요약을 채워 재커밋한다', async () => {
  const repo = seedRepo()

  const result = await regenerateSummary({
    repoRoot: repo, filename: 'a.md',
    summarize: async () => ({
      summary: '새 요약',
      sections: [{ heading: '액션아이템', kind: 'actions' as const, items: [{ text: '할 일' }] }],
    }),
    git: systemGit(repo),
    autoSync: true,
  })
  expect(expectOk(result).summary).toBe('새 요약')
  const saved = fs.readFileSync(path.join(repo, 'meetings', 'a.md'), 'utf-8')
  expect(saved).toContain('새 요약')
  expect(saved).toContain('- [ ] 할 일')
  const log = execFileSync('git', ['log', '--oneline'], { cwd: repo }).toString()
  expect(log.split('\n').filter(Boolean)).toHaveLength(2)  // seed + 재생성 커밋
})

test('autoSync=false: pull/push는 건너뛰고 로컬 add+commit만 수행한다', async () => {
  const repo = seedRepo()
  const { git, calls } = recordingGit()

  await regenerateSummary({
    repoRoot: repo, filename: 'a.md',
    summarize: async () => ({ summary: '새 요약', sections: [] }),
    git,
    autoSync: false,
  })

  expect(calls).not.toContainEqual(['pull', '--rebase'])
  expect(calls).not.toContainEqual(['push'])
  expect(calls.some((c) => c[0] === 'add')).toBe(true)
  expect(calls.some((c) => c[0] === 'commit')).toBe(true)
})

test('git 레포가 아닌 폴더: git 호출 없이 파일만 갱신한다', async () => {
  const repo = seedNonGitRepo()

  const { git, calls } = recordingGit()
  const result = await regenerateSummary({
    repoRoot: repo, filename: 'a.md',
    summarize: async () => ({ summary: '새 요약', sections: [] }),
    git,
    autoSync: true,
  })

  expect(expectOk(result).summary).toBe('새 요약')
  expect(calls).toHaveLength(0)
  const saved = fs.readFileSync(path.join(repo, 'meetings', 'a.md'), 'utf-8')
  expect(saved).toContain('새 요약')
})

test('요약 실패는 예외가 아니라 ok:false로 분류해 돌려준다', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const repo = seedRepo()
  const { git, calls } = recordingGit()

  const result = await regenerateSummary({
    repoRoot: repo, filename: 'a.md',
    summarize: async () => {
      throw new ClaudeRunError({
        stdout: 'Not logged in · Please run /login',
        stderr: '',
        exitCode: 1,
        errorCode: null,
        killed: false,
        signal: null,
        timeoutMs: 300_000,
        stdinFailed: false
      })
    },
    git,
    autoSync: true,
  })

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('unreachable')
  expect(result.failure.reason).toBe('not_authenticated')
  expect(result.failure.detail).toContain('Not logged in')
  // 실패했으면 파일도 커밋도 건드리지 않는다.
  expect(fs.readFileSync(path.join(repo, 'meetings', 'a.md'), 'utf-8')).not.toContain('Not logged in')
  expect(calls.some((c) => c[0] === 'commit')).toBe(false)
})

// 분류 범위를 요약 호출 밖으로 넓히면 파일 부재의 ENOENT까지 "claude 미설치"로 오진단한다.
test('회의록 파일이 없으면 요약 실패로 위장하지 않고 그대로 throw한다', async () => {
  const repo = seedRepo()
  const { git } = recordingGit()

  await expect(
    regenerateSummary({
      repoRoot: repo, filename: 'missing.md',
      summarize: async () => ({ summary: '새 요약', sections: [] }),
      git,
      autoSync: false,
    })
  ).rejects.toThrow()
})

// git 실패를 throw하면 렌더러가 "요약 생성 실패"로 오보한다 — 요약은 이미 디스크에 있다.
// user.email 미설정 신규 사용자에게 바로 재현되는 흔한 경로다.
test('git 커밋이 실패해도 요약은 성공으로 보고하고 경고만 붙인다', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const repo = seedRepo()
  const failingGit: RunCommand = async (_cmd, args) => {
    if (args[0] === 'commit') throw new Error('Command failed: git commit — user.email 미설정')
    return { stdout: '' }
  }

  const result = await regenerateSummary({
    repoRoot: repo, filename: 'a.md',
    summarize: async () => ({ summary: '새 요약', sections: [] }),
    git: failingGit,
    autoSync: false,
  })

  expect(expectOk(result).summary).toBe('새 요약')
  expect(result.ok && result.saveWarning).toContain('git 커밋에 실패')
  // 요약은 실제로 디스크에 남아야 한다.
  expect(fs.readFileSync(path.join(repo, 'meetings', 'a.md'), 'utf-8')).toContain('새 요약')
})
