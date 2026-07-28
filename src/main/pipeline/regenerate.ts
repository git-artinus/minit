import fs from 'node:fs'
import path from 'node:path'
import { parseMeeting, serializeMeeting } from '../../shared/meeting-file'
import type { Meeting, RegenerateResult } from '../../shared/types'
import type { RunCommand } from './transcriber'
import type { SummaryResult } from './summarizer'
import { classifySummaryError } from './summary-error'
import { isGitRepo, tryPullRebase } from './storage'

export async function regenerateSummary(deps: {
  repoRoot: string
  filename: string
  // 저장된 회의 전체를 넘긴다 — 호출자가 meetingType·participants로 타입별 프롬프트를 구성한다(v0.6.0 #3).
  summarize: (meeting: Meeting) => Promise<SummaryResult>
  git: RunCommand
  // false면 pull/push를 건너뛰고 로컬 add+commit만 수행한다(자동 push 토글 off).
  autoSync: boolean
}): Promise<RegenerateResult> {
  const gitRepo = isGitRepo(deps.repoRoot)

  if (deps.autoSync && gitRepo) await tryPullRebase(deps.git)
  const filePath = path.join(deps.repoRoot, 'meetings', deps.filename)
  const meeting = parseMeeting(deps.filename, fs.readFileSync(filePath, 'utf-8'))

  // 분류는 이 호출 하나만 감싼다. 범위를 넓히면 파일 부재·git 미설치의 ENOENT까지
  // "claude 미설치"로 오진단해, 사용자가 멀쩡한 CLI를 재설치하러 간다.
  let result: SummaryResult
  try {
    result = await deps.summarize(meeting)
  } catch (e) {
    return { ok: false, failure: classifySummaryError(e) }
  }

  const updated: Meeting = { ...meeting, ...result }
  fs.writeFileSync(filePath, serializeMeeting(updated))

  if (!gitRepo) return { ok: true, meeting: updated }

  await deps.git('git', ['add', path.join('meetings', deps.filename)])
  await deps.git('git', ['commit', '-m', `docs(meetings): ${meeting.title} 요약 재생성`])
  if (deps.autoSync) {
    try { await deps.git('git', ['push']) } catch { /* pushPending이 다음 목록 조회 때 재시도 */ }
  }
  return { ok: true, meeting: updated }
}
