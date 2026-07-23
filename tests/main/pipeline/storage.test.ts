import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { isGitRepo, loadMeetings, pushPending, saveMeeting, systemGit } from '../../../src/main/pipeline/storage'
import type { RunCommand } from '../../../src/main/pipeline/transcriber'

// 실제 git 프로세스를 띄우지 않고 호출된 args만 기록하는 mock. autoSync 분기가
// 원격 접촉(pull/push)을 실제로 건너뛰는지 "호출 여부"로 직접 검증하기 위함.
function recordingGit(): { git: RunCommand; calls: string[][] } {
  const calls: string[][] = []
  const git: RunCommand = async (_cmd, args) => {
    calls.push(args)
    return { stdout: '' }
  }
  return { git, calls }
}

let repo: string
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-repo-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo })
})

const meeting = {
  title: '주간 스탠드업', date: '2026-07-20T10:30:00+09:00', durationMin: 32,
  participants: ['조엘'], summary: '요약.', actionItems: [], segments: [{ startMs: 0, text: '안녕하세요.' }],
}

describe('isGitRepo', () => {
  test('.git 디렉토리가 있으면 true', () => {
    expect(isGitRepo(repo)).toBe(true)
  })

  test('.git 디렉토리가 없으면 false', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-plain-'))
    try {
      expect(isGitRepo(plain)).toBe(false)
    } finally {
      fs.rmSync(plain, { recursive: true })
    }
  })
})

describe('saveMeeting', () => {
  test('파일을 쓰고 커밋한다. remote가 없으면 pushed=false지만 커밋은 남는다', async () => {
    const result = await saveMeeting({ repoRoot: repo, meeting, startedAt: new Date('2026-07-20T10:30:00+09:00'), git: systemGit(repo), autoSync: true })
    expect(result.filename).toBe('2026-07-20-주간-스탠드업.md')
    expect(result.pushed).toBe(false)  // remote 없음 → push 실패 → 로컬 커밋 유지
    expect(fs.existsSync(path.join(repo, 'meetings', result.filename))).toBe(true)
    const log = execFileSync('git', ['log', '--oneline'], { cwd: repo }).toString()
    expect(log).toContain('주간 스탠드업')
  })
  test('같은 날짜·제목이 이미 있으면 파일명에 -2를 붙인다', async () => {
    const started = new Date('2026-07-20T10:30:00+09:00')
    await saveMeeting({ repoRoot: repo, meeting, startedAt: started, git: systemGit(repo), autoSync: true })
    const second = await saveMeeting({ repoRoot: repo, meeting, startedAt: started, git: systemGit(repo), autoSync: true })
    expect(second.filename).toBe('2026-07-20-주간-스탠드업-2.md')
  })

  test('pull --rebase가 CONFLICT로 실패해도 저장은 성공하고 rebase 상태를 남기지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-conflict-'))
    const bare = path.join(root, 'remote.git')
    execFileSync('git', ['init', '--bare', '-b', 'main', bare])

    const cloneA = path.join(root, 'a')
    const cloneB = path.join(root, 'b')
    execFileSync('git', ['clone', bare, cloneA])
    execFileSync('git', ['clone', bare, cloneB])
    for (const dir of [cloneA, cloneB]) {
      execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
      execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
    }

    // A: shared.txt를 만들어 커밋하고 push한다
    fs.writeFileSync(path.join(cloneA, 'shared.txt'), 'from A\n')
    execFileSync('git', ['add', 'shared.txt'], { cwd: cloneA })
    execFileSync('git', ['commit', '-m', 'A: shared.txt'], { cwd: cloneA })
    execFileSync('git', ['push', 'origin', 'main'], { cwd: cloneA })

    // B: A의 커밋을 pull하지 않은 채, 같은 파일에 충돌하는 내용을 로컬 커밋한다
    fs.writeFileSync(path.join(cloneB, 'shared.txt'), 'from B\n')
    execFileSync('git', ['add', 'shared.txt'], { cwd: cloneB })
    execFileSync('git', ['commit', '-m', 'B: shared.txt'], { cwd: cloneB })

    // saveMeeting 내부의 pull --rebase가 add/add CONFLICT로 실패한다
    const result = await saveMeeting({
      repoRoot: cloneB,
      meeting,
      startedAt: new Date('2026-07-20T10:30:00+09:00'),
      git: systemGit(cloneB),
      autoSync: true,
    })

    expect(result.pushed).toBe(false)
    expect(fs.existsSync(path.join(cloneB, 'meetings', result.filename))).toBe(true)
    const log = execFileSync('git', ['log', '--oneline'], { cwd: cloneB }).toString()
    expect(log).toContain('주간 스탠드업')
    // rebase 중간 상태가 남아있지 않아야 한다 (detached HEAD·unmerged paths 없음)
    expect(fs.existsSync(path.join(cloneB, '.git', 'rebase-merge'))).toBe(false)
    expect(fs.existsSync(path.join(cloneB, '.git', 'rebase-apply'))).toBe(false)
    const status = execFileSync('git', ['status'], { cwd: cloneB }).toString()
    expect(status).not.toContain('rebase in progress')
  })

  test('autoSync=false: pull/push는 건너뛰지만 파일 write·add·commit은 수행한다 (원격 접촉 0)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-autosync-off-'))
    fs.mkdirSync(path.join(dir, '.git')) // isGitRepo 판정용 — mock git이라 실제 git 동작은 불필요
    try {
      const { git, calls } = recordingGit()
      const result = await saveMeeting({
        repoRoot: dir, meeting, startedAt: new Date('2026-07-20T10:30:00+09:00'), git, autoSync: false,
      })

      expect(calls).not.toContainEqual(['pull', '--rebase'])
      expect(calls).not.toContainEqual(['push'])
      expect(calls.some((c) => c[0] === 'commit')).toBe(true)
      expect(fs.existsSync(path.join(dir, 'meetings', result.filename))).toBe(true)
      expect(result.pushed).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  test('autoSync=true: pull --rebase와 push를 모두 시도한다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-autosync-on-'))
    fs.mkdirSync(path.join(dir, '.git')) // isGitRepo 판정용 — mock git이라 실제 git 동작은 불필요
    try {
      const { git, calls } = recordingGit()
      await saveMeeting({
        repoRoot: dir, meeting, startedAt: new Date('2026-07-20T10:30:00+09:00'), git, autoSync: true,
      })

      expect(calls).toContainEqual(['pull', '--rebase'])
      expect(calls).toContainEqual(['push'])
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  test('git 레포가 아닌 폴더: git 호출 없이 파일만 저장하고 pushed=false를 반환한다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-nongit-'))
    try {
      const { git, calls } = recordingGit()
      const result = await saveMeeting({
        repoRoot: dir, meeting, startedAt: new Date('2026-07-20T10:30:00+09:00'), git, autoSync: true,
      })

      expect(calls).toHaveLength(0)
      expect(result.pushed).toBe(false)
      expect(fs.existsSync(path.join(dir, 'meetings', result.filename))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})

describe('pushPending', () => {
  test('autoSync=false: git을 전혀 호출하지 않고 false를 반환한다', async () => {
    const { git, calls } = recordingGit()
    const result = await pushPending({ repoRoot: repo, git, autoSync: false })
    expect(result).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('autoSync=true: pull --rebase 후 push를 시도한다', async () => {
    const { git, calls } = recordingGit()
    const result = await pushPending({ repoRoot: repo, git, autoSync: true })
    expect(result).toBe(true)
    expect(calls).toContainEqual(['pull', '--rebase'])
    expect(calls).toContainEqual(['push'])
  })

  test('git 레포가 아닌 폴더: autoSync=true여도 git 호출 없이 즉시 false를 반환한다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuting-nongit-'))
    try {
      const { git, calls } = recordingGit()
      const result = await pushPending({ repoRoot: dir, git, autoSync: true })
      expect(result).toBe(false)
      expect(calls).toHaveLength(0)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})

describe('loadMeetings', () => {
  test('meetings/*.md를 파싱해 반환한다 (md 외 파일 무시)', async () => {
    await saveMeeting({ repoRoot: repo, meeting, startedAt: new Date('2026-07-20T10:30:00+09:00'), git: systemGit(repo), autoSync: true })
    fs.writeFileSync(path.join(repo, 'meetings', '.gitkeep'), '')
    const list = await loadMeetings(repo)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('주간 스탠드업')
    expect(list[0].segments[0].text).toBe('안녕하세요.')
  })
  test('meetings 디렉토리가 없으면 빈 배열', async () => {
    expect(await loadMeetings(repo)).toEqual([])
  })

  test('손상된 md 파일이 섞여 있어도 나머지는 정상 로드된다 (corrupt 파일 하나가 목록 전체를 죽이면 안 됨)', async () => {
    await saveMeeting({ repoRoot: repo, meeting, startedAt: new Date('2026-07-20T10:30:00+09:00'), git: systemGit(repo), autoSync: true })
    fs.writeFileSync(path.join(repo, 'meetings', 'broken.md'), '---\ntitle: {broken\n---\n본문')
    const list = await loadMeetings(repo)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('주간 스탠드업')
  })
})
