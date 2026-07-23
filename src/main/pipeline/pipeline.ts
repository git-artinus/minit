import type {
  Meeting, MeetingMeta, PipelineStatus, TranscriptSegment,
} from '../../shared/types'
import type { SaveResult } from './storage'
import type { SummaryResult } from './summarizer'

export interface PipelineDeps {
  transcribe: () => Promise<TranscriptSegment[]>
  summarize: (segments: TranscriptSegment[]) => Promise<SummaryResult>
  save: (meeting: Omit<Meeting, 'filename'>) => Promise<SaveResult>
  onStatus: (s: PipelineStatus) => void
  cleanupAudio: () => void
}

export async function runPipeline(
  recordingId: string, meta: MeetingMeta, deps: PipelineDeps,
): Promise<{ filename: string } | { failedStage: 'transcribing' | 'saving' }> {
  const emit = (s: Omit<PipelineStatus, 'recordingId'>) =>
    deps.onStatus({ recordingId, ...s })

  emit({ stage: 'transcribing' })
  let segments: TranscriptSegment[]
  try {
    segments = await deps.transcribe()
  } catch (e) {
    emit({ stage: 'transcribing', error: { stage: 'transcribing', message: message(e) } })
    return { failedStage: 'transcribing' }  // 오디오 보관 — cleanupAudio 호출 안 함
  }

  emit({ stage: 'summarizing' })
  let summaryError: PipelineStatus['error']
  let summary: SummaryResult = { summary: '', actionItems: [] }
  try {
    summary = await deps.summarize(segments)
  } catch (e) {
    summaryError = { stage: 'summarizing', message: message(e) }  // 폴백: 트랜스크립트만 저장
  }

  emit({ stage: 'saving', error: summaryError })
  let saved: SaveResult
  try {
    saved = await deps.save({ ...meta, ...summary, segments })
  } catch (e) {
    // 저장 실패 — 오디오는 이미 남아 있으므로(cleanupAudio 미호출) 재시도를 위해 보관된다
    emit({ stage: 'saving', error: { stage: 'saving', message: message(e) } })
    return { failedStage: 'saving' }
  }

  try {
    deps.cleanupAudio()  // 저장 성공 이후에만 폐기 — 스펙 §6(녹음 결과물 무유실)
  } catch {
    // best-effort: 정리 실패는 저장이 끝난 뒤이므로 파이프라인 결과에 영향을 주지 않는다
  }

  emit({ stage: 'done', filename: saved.filename, error: summaryError })
  return { filename: saved.filename }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
