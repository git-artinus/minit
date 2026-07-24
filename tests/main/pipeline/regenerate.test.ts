import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { serializeMeeting } from '../../../src/shared/meeting-file'
import { regenerateSummary } from '../../../src/main/pipeline/regenerate'
import { systemGit } from '../../../src/main/pipeline/storage'
import type { RunCommand } from '../../../src/main/pipeline/transcriber'

function recordingGit(): { git: RunCommand; calls: string[][] } {
  const calls: string[][] = []
  const git: RunCommand = async (_cmd, args) => {
    calls.push(args)
    return { stdout: '' }
  }
  return { git, calls }
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

test('요약 없는 회의록에 요약을 채워 재커밋한다', async () => {
  const repo = seedRepo()

  const updated = await regenerateSummary({
    repoRoot: repo, filename: 'a.md',
    summarize: async () => ({
      summary: '새 요약',
      sections: [{ heading: '액션아이템', kind: 'actions' as const, items: [{ text: '할 일' }] }],
    }),
    git: systemGit(repo),
    autoSync: true,
  })
  expect(updated.summary).toBe('새 요약')
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
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-regen-nongit-'))
  fs.mkdirSync(path.join(repo, 'meetings'))
  const raw = serializeMeeting({
    meetingType: 'general', title: '회의', date: '2026-07-20T10:00:00+09:00', durationMin: 10, participants: [],
    summary: '', sections: [], segments: [{ startMs: 0, text: '안녕하세요.' }],
  })
  fs.writeFileSync(path.join(repo, 'meetings', 'a.md'), raw)

  const { git, calls } = recordingGit()
  const updated = await regenerateSummary({
    repoRoot: repo, filename: 'a.md',
    summarize: async () => ({ summary: '새 요약', sections: [] }),
    git,
    autoSync: true,
  })

  expect(updated.summary).toBe('새 요약')
  expect(calls).toHaveLength(0)
  const saved = fs.readFileSync(path.join(repo, 'meetings', 'a.md'), 'utf-8')
  expect(saved).toContain('새 요약')
})
