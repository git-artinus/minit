import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { minitHome } from '../settings'
import type { RunWithStdin } from './summarizer'

export const SUMMARY_TIMEOUT_MS = 300_000
const MAX_BUFFER = 64 * 1024 * 1024

// claude CLI는 실행되면 작업 디렉토리 컨텍스트를 읽는다. Finder/Dock으로 실행된 패키징
// 앱은 cwd가 '/'라서 CLI의 탐색이 홈 전체로 번지고, ~/Pictures·~/Music·다른 앱 컨테이너
// 접근이 전부 Minit.app 명의의 TCC 권한 프롬프트로 나타났다(사진·Apple Music·"다른 앱의
// 데이터" 요청의 원인). 항상 존재를 보장할 수 있는 회의록 홈(~/.minit)으로 고정한다.
export function claudeWorkdir(): string {
  const dir = minitHome()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 실패한 실행에 대해 알아낸 사실 전부. 위치 인자 8개를 피하려고 객체로 묶는다. */
export interface ClaudeRunFacts {
  stdout: string
  stderr: string
  /** err.code가 숫자일 때만 — 프로세스 종료 코드 */
  exitCode: number | null
  /** err.code가 문자열일 때만 — 'ENOENT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' 등 */
  errorCode: string | null
  killed: boolean
  /** 시그널로 죽었으면 그 이름. 이걸 버리면 SIGKILL(메모리 부족 등)이 "출력 없는 실패"로 뭉개진다. */
  signal: NodeJS.Signals | null
  /** 이 실행에 적용된 제한 시간 — 메시지가 실제 값을 말하도록 함께 담는다. */
  timeoutMs: number
  /** stdin을 끝까지 넘기지 못했다(EPIPE 등). 부분 입력으로 만든 요약은 성공이 아니다. */
  stdinFailed: boolean
}

/**
 * claude 실행 실패. execFile의 기본 에러로는 원인을 알 수 없어서 이 클래스가 필요하다 —
 * message가 `Command failed: claude -p <프롬프트 전문>` 형태라 원인이 프롬프트에 묻히고,
 * 정작 claude가 원인을 쓰는 곳(stdout)은 execFile 콜백에서 그냥 버려지기 때문이다.
 *
 * 브랜드 클래스인 이유: 분류기가 아무 Error나 받으면 회의록 파일 부재·git 미설치의
 * ENOENT까지 "claude 미설치"로 오진단한다. 그건 원인 미상보다 나쁘다(틀린 확신을 준다).
 */
export class ClaudeRunError extends Error {
  constructor(readonly run: ClaudeRunFacts) {
    // 분류기를 거치지 않는 일반 핸들러(pipeline의 message(e) 등)에 걸려도 최소한의 단서는 남게 한다.
    super(`claude 실행 실패 (${summarizeCause(run)})`)
    this.name = 'ClaudeRunError'
  }

  /** timedOut을 따로 저장하지 않는다 — killed·signal에서 파생시켜 진실을 한 곳에 둔다. */
  get timedOut(): boolean {
    return this.run.killed && this.run.signal === 'SIGTERM'
  }
}

function summarizeCause(run: ClaudeRunFacts): string {
  if (run.errorCode !== null) return run.errorCode
  if (run.killed && run.signal === 'SIGTERM') return '시간 초과'
  if (run.signal !== null) return `시그널 ${run.signal}`
  if (run.stdinFailed) return '입력 전달 실패'
  return run.exitCode !== null ? `exit ${run.exitCode}` : '원인 불명'
}

// timeoutMs는 호출자가 용도에 맞게 지정한다(요약 300초 · 상태 확인 60초). 기본값은 요약 기준이다.
export const runWithStdin: RunWithStdin = (cmd, args, stdin, timeoutMs = SUMMARY_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { maxBuffer: MAX_BUFFER, timeout: timeoutMs, cwd: claudeWorkdir() },
      (err, stdout, stderr) => {
        // 전량 전달 여부는 error 이벤트 플래그가 아니라 스트림 상태로 판정한다 — EPIPE가 이 콜백보다
        // 늦게 도착할 수 있어(실측) 플래그만 보면 놓친다. writableFinished는 모든 데이터가 파이프에
        // 실린 뒤에만 true가 되고, 중간에 끊기면 스트림이 destroy되며 false로 남는다.
        const stdinFailed = child.stdin!.writableFinished !== true
        // Node는 종료 코드(숫자)와 spawn·내부 오류 코드(문자열)를 err.code 한 곳에 섞어 담는다.
        const code: unknown = err?.code
        const facts: ClaudeRunFacts = {
          stdout,
          stderr,
          // err가 없으면 프로세스는 0으로 끝난 것이다(입력 전달만 실패한 경우가 여기 온다).
          exitCode: err ? (typeof code === 'number' ? code : null) : 0,
          errorCode: typeof code === 'string' ? code : null,
          killed: err?.killed === true,
          signal: err?.signal ?? null,
          timeoutMs,
          stdinFailed
        }

        // exit 0이어도 stdin을 다 못 넘겼다면 자식은 트랜스크립트 일부만 보고 요약한 것이다.
        // 이걸 성공으로 통과시키면 부분 입력 요약이 경고 없이 저장·커밋·발송된다 —
        // 크래시보다 나쁘다(조용히 틀린 답을 만든다).
        if (!err && !stdinFailed) return resolve({ stdout })
        reject(new ClaudeRunError(facts))
      }
    )

    // claude가 stdin을 다 읽기 전에 끝나는 것은 정상 실패 경로다(미인증이면 즉시 종료한다).
    // 이때 트랜스크립트가 OS 파이프 버퍼(darwin은 최대 64KB)를 넘으면 EPIPE가 나는데, 리스너가
    // 없으면 Node가 unhandled 'error'로 main 프로세스를 죽인다(관측: 1시간대 회의, 약 100KB).
    // 크래시만 막고 사실은 버리지 않는다 — 전달 실패는 위에서 writableFinished로 판정한다.
    child.stdin!.on('error', () => {})
    child.stdin!.end(stdin)
  })
