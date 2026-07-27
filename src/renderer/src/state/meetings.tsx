import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from 'react'
import { startRecording, type RecorderHandle } from '../audio/recorder'
import { webmToWav } from '../audio/webm-to-wav'
import { defaultMeetingTitle, localIsoNow } from '../../../shared/meeting-file'
import type { Meeting, MeetingMeta, PipelineStatus } from '../../../shared/types'
import { useSetup } from './setup'

export type View = { kind: 'idle' } | { kind: 'recording'; recordingId: string; meta: MeetingMeta }
export interface MeetingsState {
  meetings: Meeting[]
  selected?: string
  pipelines: Record<string, PipelineStatus>
  view: View
}

export interface MeetingsApi extends MeetingsState {
  refresh(): Promise<void>
  select(filename: string): void
  deleteMeeting(filename: string): Promise<void>
  startMeeting(meta: MeetingMeta): Promise<void>
  stopMeeting(): Promise<void>
  retryPipeline(recordingId: string): Promise<void>
}

type Action =
  | { type: 'loaded'; meetings: Meeting[] }
  | { type: 'select'; filename: string }
  | { type: 'deselect' }
  | { type: 'view'; view: View }
  | { type: 'pipeline'; status: PipelineStatus }

function reducer(state: MeetingsState, a: Action): MeetingsState {
  switch (a.type) {
    case 'loaded':
      return { ...state, meetings: a.meetings }
    case 'select':
      return { ...state, selected: a.filename }
    case 'deselect':
      return { ...state, selected: undefined }
    case 'view':
      return { ...state, view: a.view }
    case 'pipeline':
      return { ...state, pipelines: { ...state.pipelines, [a.status.recordingId]: a.status } }
  }
}

const Ctx = createContext<MeetingsApi | null>(null)

function useMeetingsInternal(): MeetingsApi {
  const [state, dispatch] = useReducer(reducer, {
    meetings: [],
    pipelines: {},
    view: { kind: 'idle' }
  })
  const { ready, expand } = useSetup()
  const recorderRef = useRef<RecorderHandle | null>(null)
  // 파이프라인 시작 시점의 meta를 recordingId별로 보관해둔다 — 실패(전사·저장) 후
  // 재시도(retryPipeline)할 때 같은 title/date/participants로 다시 돌릴 수 있게 한다.
  const metasRef = useRef<Record<string, MeetingMeta & { durationMin: number }>>({})

  const refresh = async (): Promise<void> =>
    dispatch({ type: 'loaded', meetings: await window.minuting.listMeetings() })

  useEffect(() => {
    refresh()
    const offStatus = window.minuting.onPipelineStatus((s) => {
      dispatch({ type: 'pipeline', status: s as PipelineStatus })
      if ((s as PipelineStatus).stage === 'done') {
        delete metasRef.current[(s as PipelineStatus).recordingId]
        refresh()
      }
    })
    // 외부(git 등)에서 meetings/가 바뀌어도 창에 다시 포커스하면 목록을 새로고침한다.
    window.addEventListener('focus', refresh)
    return () => {
      offStatus()
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const startMeeting = async (meta: MeetingMeta): Promise<void> => {
    const recordingId = crypto.randomUUID()
    recorderRef.current = await startRecording(recordingId, window.minuting.flushChunk)
    await window.minuting.setRecordingState(true)
    dispatch({ type: 'view', view: { kind: 'recording', recordingId, meta } })
  }

  const stopMeeting = async (): Promise<void> => {
    if (state.view.kind !== 'recording' || !recorderRef.current) return
    const { recordingId, meta } = state.view
    // recorder를 null로 만들기 전에 elapsedMs를 지역 변수로 추출해둔다 (브리프가 지적한 버그 수정).
    const elapsedMs = recorderRef.current.elapsedMs()
    const blob = await recorderRef.current.stop()
    recorderRef.current = null
    await window.minuting.setRecordingState(false)
    const durationMin = Math.max(1, Math.round(elapsedMs / 60000))
    dispatch({ type: 'view', view: { kind: 'idle' } })
    metasRef.current[recordingId] = { ...meta, durationMin }
    try {
      const wav = await webmToWav(blob)
      await window.minuting.runPipeline({ ...meta, durationMin, recordingId }, wav)
    } catch (e) {
      dispatch({
        type: 'pipeline',
        status: {
          recordingId,
          stage: 'transcribing',
          error: { stage: 'transcribing', message: e instanceof Error ? e.message : String(e) }
        }
      })
    }
  }

  // 트레이 명령 처리: view.kind·ready가 바뀔 때마다 재등록해 최신 state를 참조한다(stale closure 방지).
  // 온보딩 비차단화(v0.3.0 ①): 구성(whisper+model) 미완료 시 녹음을 시작하지 않고 패널만 펼친다
  // (창은 main 프로세스의 tray onStart에서 이미 show()한다).
  useEffect(() => {
    const offTray = window.minuting.onTrayCommand((cmd) => {
      if (cmd === 'start-meeting' && state.view.kind === 'idle') {
        if (!ready) {
          expand()
          return
        }
        const now = new Date()
        startMeeting({
          title: defaultMeetingTitle(now),
          date: localIsoNow(now),
          durationMin: 0,
          participants: []
        })
      }
      if (cmd === 'stop-meeting') stopMeeting()
    })
    return () => {
      offTray()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startMeeting/stopMeeting은 매 렌더 재생성되는 클로저라 deps에 넣으면 매 렌더 재구독된다; view.kind·ready 변화 시점에만 재등록하면 충분하다.
  }, [state.view.kind, ready])

  // 크래시 복구: 종료되지 못한 녹음이 남아 있으면 전사 파이프라인 재개를 제안한다.
  useEffect(() => {
    window.minuting.findRecoverableRecordings().then(async (ids) => {
      for (const id of ids) {
        if (!confirm('완료되지 않은 녹음이 있습니다. 지금 전사할까요?')) continue
        try {
          const buf = await window.minuting.readRecoverableRecording(id)
          const wav = await webmToWav(new Blob([buf], { type: 'audio/webm' }))
          const now = new Date()
          const meta = {
            title: `복구된 회의 ${localIsoNow(now).slice(0, 10)}`,
            date: localIsoNow(now),
            durationMin: 0,
            participants: []
          }
          metasRef.current[id] = meta
          await window.minuting.runPipeline({ ...meta, recordingId: id }, wav)
        } catch (e) {
          dispatch({
            type: 'pipeline',
            status: {
              recordingId: id,
              stage: 'transcribing',
              error: { stage: 'transcribing', message: e instanceof Error ? e.message : String(e) }
            }
          })
        }
      }
    }).catch(() => {})
  }, [])

  // 전사·저장 실패 카드의 재시도 버튼이 호출한다. saving 실패까지 포함해 오디오는
  // cleanupAudio가 성공 이후에만 실행되므로 항상 보관돼 있다(파이프라인 전체 재실행이 유효한 복구책).
  const retryPipeline = async (recordingId: string): Promise<void> => {
    try {
      const buf = await window.minuting.readRecoverableRecording(recordingId)
      const wav = await webmToWav(new Blob([buf], { type: 'audio/webm' }))
      const meta = metasRef.current[recordingId] ?? {
        title: '복구된 회의',
        date: localIsoNow(),
        durationMin: 0,
        participants: []
      }
      await window.minuting.runPipeline({ ...meta, recordingId }, wav)
    } catch (e) {
      dispatch({
        type: 'pipeline',
        status: {
          recordingId,
          stage: 'transcribing',
          error: { stage: 'transcribing', message: e instanceof Error ? e.message : String(e) }
        }
      })
    }
  }

  // 확인 다이얼로그·파일 삭제·git·원격 정리는 모두 main이 한다(meetings:delete). 렌더러는 취소가
  // 아닐 때 목록을 다시 읽고, 지워진 회의록이 열려 있었으면 상세 선택만 비운다.
  const deleteMeeting = async (filename: string): Promise<void> => {
    const { canceled } = await window.minuting.deleteMeeting(filename)
    if (canceled) return
    if (state.selected === filename) dispatch({ type: 'deselect' })
    await refresh()
  }

  const select = (filename: string): void => dispatch({ type: 'select', filename })
  return { ...state, refresh, select, deleteMeeting, startMeeting, stopMeeting, retryPipeline }
}

export function MeetingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useMeetingsInternal()}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- Context+useReducer로 IPC 호출을 한 파일에 모으는 설계(Task 12 스펙)라 훅·타입을 함께 export한다.
export function useMeetings(): MeetingsApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('MeetingsProvider 밖에서 useMeetings를 호출했다')
  return v
}
