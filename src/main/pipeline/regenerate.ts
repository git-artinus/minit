import fs from 'node:fs'
import path from 'node:path'
import { parseMeeting, serializeMeeting } from '../../shared/meeting-file'
import type { Meeting, TranscriptSegment } from '../../shared/types'
import type { RunCommand } from './transcriber'
import type { SummaryResult } from './summarizer'
import { isGitRepo, tryPullRebase } from './storage'

export async function regenerateSummary(deps: {
  repoRoot: string
  filename: string
  summarize: (segments: TranscriptSegment[], title: string) => Promise<SummaryResult>
  git: RunCommand
  // false면 pull/push를 건너뛰고 로컬 add+commit만 수행한다(자동 push 토글 off).
  autoSync: boolean
}): Promise<Meeting> {
  const gitRepo = isGitRepo(deps.repoRoot)

  if (deps.autoSync && gitRepo) await tryPullRebase(deps.git)
  const filePath = path.join(deps.repoRoot, 'meetings', deps.filename)
  const meeting = parseMeeting(deps.filename, fs.readFileSync(filePath, 'utf-8'))
  const result = await deps.summarize(meeting.segments, meeting.title)
  const updated: Meeting = { ...meeting, ...result }
  fs.writeFileSync(filePath, serializeMeeting(updated))

  if (!gitRepo) return updated

  await deps.git('git', ['add', path.join('meetings', deps.filename)])
  await deps.git('git', ['commit', '-m', `docs(meetings): ${meeting.title} 요약 재생성`])
  if (deps.autoSync) {
    try { await deps.git('git', ['push']) } catch { /* pushPending이 다음 목록 조회 때 재시도 */ }
  }
  return updated
}
