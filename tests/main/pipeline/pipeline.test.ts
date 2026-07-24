import { describe, expect, test, vi } from 'vitest'
import { runPipeline } from '../../../src/main/pipeline/pipeline'
import type { PipelineStatus } from '../../../src/shared/types'

const meta = { title: '회의', date: '2026-07-20T10:00:00+09:00', durationMin: 30, participants: [] }
const segments = [{ startMs: 0, text: '안녕하세요.' }]

function deps(over: Partial<Parameters<typeof runPipeline>[2]> = {}) {
  const statuses: PipelineStatus[] = []
  const d = {
    transcribe: vi.fn(async () => segments),
    summarize: vi.fn(async () => ({ summary: '요약', sections: [] })),
    save: vi.fn(async () => ({ filename: 'f.md', pushed: true })),
    onStatus: (s: PipelineStatus) => statuses.push(s),
    cleanupAudio: vi.fn(),
    ...over,
  }
  return { d, statuses }
}

describe('runPipeline', () => {
  test('정상 흐름: transcribing→summarizing→saving→done, 오디오 폐기', async () => {
    const { d, statuses } = deps()
    const result = await runPipeline('rec1', meta, d)
    expect(statuses.map((s) => s.stage)).toEqual(['transcribing', 'summarizing', 'saving', 'done'])
    expect(d.cleanupAudio).toHaveBeenCalled()
    expect(result).toEqual({ filename: 'f.md' })
  })
  test('요약 실패: 빈 요약으로 저장은 계속, error에 summarizing 기록', async () => {
    const { d, statuses } = deps({ summarize: vi.fn(async () => { throw new Error('claude 없음') }) })
    const result = await runPipeline('rec1', meta, d)
    expect(result).toHaveProperty('filename')
    expect(d.save).toHaveBeenCalledWith(expect.objectContaining({ summary: '', sections: [], meetingType: 'general' }))
    const done = statuses.at(-1)!
    expect(done.stage).toBe('done')
    expect(done.error).toEqual({ stage: 'summarizing', message: 'claude 없음' })
  })
  test('전사 실패: 오디오를 폐기하지 않고 중단', async () => {
    const { d, statuses } = deps({ transcribe: vi.fn(async () => { throw new Error('boom') }) })
    const result = await runPipeline('rec1', meta, d)
    expect(result).toEqual({ failedStage: 'transcribing' })
    expect(d.cleanupAudio).not.toHaveBeenCalled()
    expect(d.save).not.toHaveBeenCalled()
    expect(statuses.at(-1)!.error?.stage).toBe('transcribing')
  })
  test('저장 실패: saving 단계 오류 기록, 오디오 보관(cleanupAudio 호출 안 함), 실패 반환', async () => {
    const { d, statuses } = deps({ save: vi.fn(async () => { throw new Error('디스크 가득') }) })
    const result = await runPipeline('rec1', meta, d)
    expect(result).toEqual({ failedStage: 'saving' })
    expect(d.cleanupAudio).not.toHaveBeenCalled()
    const last = statuses.at(-1)!
    expect(last.stage).toBe('saving')
    expect(last.error).toEqual({ stage: 'saving', message: '디스크 가득' })
  })
  test('오디오 정리 실패: 저장은 이미 성공했으므로 파이프라인은 정상 완료', async () => {
    const { d, statuses } = deps({ cleanupAudio: vi.fn(() => { throw new Error('파일 잠김') }) })
    const result = await runPipeline('rec1', meta, d)
    expect(result).toEqual({ filename: 'f.md' })
    expect(statuses.at(-1)!.stage).toBe('done')
  })
  test('정상 흐름: cleanupAudio는 save 성공 이후에 정확히 한 번 호출', async () => {
    const log: string[] = []
    const { d } = deps({
      save: vi.fn(async () => {
        log.push('save')
        return { filename: 'f.md', pushed: true }
      }),
      cleanupAudio: vi.fn(() => { log.push('cleanupAudio') }),
    })
    await runPipeline('rec1', meta, d)
    expect(log).toEqual(['save', 'cleanupAudio'])
  })
})
