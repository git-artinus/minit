import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { isValidMeetingFilename, meetingFilename, parseMeeting, serializeMeeting } from '../../shared/meeting-file'
import type { Meeting } from '../../shared/types'
import type { RunCommand } from './transcriber'

const execFileP = promisify(execFile)

export function systemGit(cwd: string): RunCommand {
  return async (_cmd, args) => {
    // 자격증명 프롬프트·네트워크 행(hang)으로 파이프라인이 무기한 멈추는 것을 방지한다.
    const { stdout } = await execFileP('git', args, { cwd, timeout: 60_000 })
    return { stdout }
  }
}

export interface SaveResult { filename: string; pushed: boolean }

// repoRoot가 git 레포인지 여부. git 레포가 아닌 일반 폴더(예: ~/.minit 기본값)에서는
// pull/add/commit/push를 모두 건너뛰고 파일만 저장한다.
export function isGitRepo(repoRoot: string): boolean {
  return fs.existsSync(path.join(repoRoot, '.git'))
}

// 원격 최신화는 시도만 — 실패(오프라인·remote 없음·충돌 모두)해도 저장은 계속한다.
// pull이 CONFLICT로 실패하면 git이 rebase 중간 상태(detached HEAD·unmerged paths)로
// 남는데, 이를 방치하면 뒤이은 add+commit이 거부되고 이후 모든 저장이 실패한다.
// rebase --abort로 pull 이전 상태로 복구해 항상 깨끗한 워킹트리를 보장한다.
export async function tryPullRebase(git: RunCommand): Promise<void> {
  try {
    await git('git', ['pull', '--rebase'])
  } catch {
    try { await git('git', ['rebase', '--abort']) } catch { /* 진행 중인 rebase가 없으면 실패 — 무시 */ }
  }
}

function uniqueFilename(dir: string, base: string): string {
  if (!fs.existsSync(path.join(dir, base))) return base
  const stem = base.replace(/\.md$/, '')
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}.md`
    if (!fs.existsSync(path.join(dir, candidate))) return candidate
  }
}

export async function saveMeeting(deps: {
  repoRoot: string
  meeting: Omit<Meeting, 'filename'>
  startedAt: Date
  git: RunCommand
  // false면 pull/push를 모두 건너뛴다(원격 접촉 0) — 자동 push 토글이 꺼졌을 때의 경로.
  // 파일 write + add + commit은 두 경우 모두 수행한다(실패 격리 원칙 유지).
  autoSync: boolean
}): Promise<SaveResult> {
  const dir = path.join(deps.repoRoot, 'meetings')
  fs.mkdirSync(dir, { recursive: true })

  const gitRepo = isGitRepo(deps.repoRoot)

  if (deps.autoSync && gitRepo) await tryPullRebase(deps.git)

  const filename = uniqueFilename(dir, meetingFilename(deps.meeting.title, deps.startedAt))
  fs.writeFileSync(path.join(dir, filename), serializeMeeting(deps.meeting))

  if (!gitRepo) return { filename, pushed: false }

  await deps.git('git', ['add', path.join('meetings', filename)])
  await deps.git('git', ['commit', '-m', `docs(meetings): ${deps.meeting.title} 회의록 추가`])

  if (!deps.autoSync) return { filename, pushed: false }

  let pushed = false
  try {
    await deps.git('git', ['push'])
    pushed = true
  } catch { /* 로컬 커밋은 남아 있음 — pushPending으로 재시도 */ }
  return { filename, pushed }
}

export interface DeleteResult { deleted: boolean; pushed: boolean }

// 커밋 메시지에 쓸 회의 제목. 렌더러가 넘긴 값을 믿지 않고 저장된 파일에서 직접 읽는다.
// 파싱 실패(손상된 파일)면 파일명으로 대체한다 — 삭제 자체를 막을 이유는 없다.
function meetingTitleOf(file: string, filename: string): string {
  try {
    return parseMeeting(filename, fs.readFileSync(file, 'utf-8')).title || filename
  } catch {
    return filename
  }
}

// 회의록 하나를 지운다. 파일은 지우기 전에 OS 휴지통으로 보내(trash 주입) 실수 복구 여지를
// 남기고, git 레포면 삭제를 스테이징해 커밋한다. 저장 경로(saveMeeting)와 같은 실패 격리
// 원칙 — git 단계 실패는 이미 끝난 파일 삭제를 되돌리지 않는다(로컬 커밋이 밀릴 뿐이며,
// 다음 저장·pushPending에서 함께 정리된다).
export async function deleteMeeting(deps: {
  repoRoot: string
  filename: string
  git: RunCommand
  autoSync: boolean
  // shell.trashItem 주입점(main 프로세스 밖에서 테스트할 수 있도록).
  trash: (absolutePath: string) => Promise<void>
}): Promise<DeleteResult> {
  if (!isValidMeetingFilename(deps.filename)) throw new Error(`invalid filename: ${deps.filename}`)

  const relative = path.join('meetings', deps.filename)
  const file = path.join(deps.repoRoot, relative)
  if (!fs.existsSync(file)) return { deleted: false, pushed: false }

  const title = meetingTitleOf(file, deps.filename)

  await deps.trash(file)

  if (!isGitRepo(deps.repoRoot)) return { deleted: true, pushed: false }

  try {
    await deps.git('git', ['add', '-A', '--', relative])
    await deps.git('git', ['commit', '-m', `docs(meetings): ${title} 회의록 삭제`])
  } catch {
    // 추적되지 않던 파일이거나 커밋 자체가 거부된 경우 — 파일은 이미 지워졌으므로 삭제는 성공이다.
    return { deleted: true, pushed: false }
  }

  if (!deps.autoSync) return { deleted: true, pushed: false }

  let pushed = false
  try {
    await deps.git('git', ['push'])
    pushed = true
  } catch { /* 로컬 커밋은 남아 있음 — pushPending으로 재시도 */ }
  return { deleted: true, pushed }
}

export async function pushPending(deps: { repoRoot: string; git: RunCommand; autoSync: boolean }): Promise<boolean> {
  if (!deps.autoSync || !isGitRepo(deps.repoRoot)) return false
  await tryPullRebase(deps.git)
  try {
    await deps.git('git', ['push'])
    return true
  } catch {
    return false
  }
}

export async function loadMeetings(repoRoot: string): Promise<Meeting[]> {
  const dir = path.join(repoRoot, 'meetings')
  if (!fs.existsSync(dir)) return []
  const meetings: Meeting[] = []
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    try {
      meetings.push(parseMeeting(f, fs.readFileSync(path.join(dir, f), 'utf-8')))
    } catch {
      // 손상된 파일 하나 때문에 meetings:list 전체가 실패해 목록이 통째로 사라지면 안 된다 — 해당 파일만 건너뛴다.
    }
  }
  return meetings
}
