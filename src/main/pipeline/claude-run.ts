import { execFile, type ExecFileException } from 'node:child_process'
import type { RunWithStdin } from './summarizer'

export const SUMMARY_TIMEOUT_MS = 300_000
const MAX_BUFFER = 64 * 1024 * 1024

/**
 * claude 실행 실패. execFile의 기본 에러로는 원인을 알 수 없어서 이 클래스가 필요하다 —
 * message가 `Command failed: claude -p <프롬프트 전문>` 형태라 원인이 프롬프트에 묻히고,
 * 정작 claude가 원인을 쓰는 곳(stdout)은 execFile 콜백에서 그냥 버려지기 때문이다.
 *
 * 브랜드 클래스인 이유: 분류기가 아무 Error나 받으면 회의록 파일 부재·git 미설치의
 * ENOENT까지 "claude 미설치"로 오진단한다. 그건 원인 미상보다 나쁘다(틀린 확신을 준다).
 */
export class ClaudeRunError extends Error {
  constructor(
    readonly stdout: string,
    readonly stderr: string,
    /** err.code가 숫자일 때만 — 프로세스 종료 코드 */
    readonly exitCode: number | null,
    /** err.code가 문자열일 때만 — 'ENOENT' 등 spawn·내부 오류 */
    readonly spawnCode: string | null,
    readonly timedOut: boolean
  ) {
    super('claude 실행 실패')
    this.name = 'ClaudeRunError'
  }
}

// Node는 종료 코드(숫자)와 spawn·내부 오류 코드(문자열)를 err.code 한 곳에 섞어 담는다.
const isTimedOut = (err: ExecFileException): boolean =>
  err.killed === true && err.signal === 'SIGTERM'

// timeoutMs는 테스트에서만 주입한다(300초를 기다리지 않고 타임아웃 경로를 검증하기 위함).
export const runWithStdin: RunWithStdin = (cmd, args, stdin, timeoutMs = SUMMARY_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { maxBuffer: MAX_BUFFER, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout })
        const code: unknown = err.code
        reject(
          new ClaudeRunError(
            stdout,
            stderr,
            typeof code === 'number' ? code : null,
            typeof code === 'string' ? code : null,
            isTimedOut(err)
          )
        )
      }
    )
    // claude가 stdin을 다 읽기 전에 끝나는 것은 정상 실패 경로다(미인증이면 즉시 종료한다).
    // 이때 파이프 버퍼(64KB)를 넘는 트랜스크립트는 EPIPE를 내는데, 리스너가 없으면 Node가
    // unhandled 'error'로 main 프로세스를 죽인다 — 약 780세그먼트(1시간 이상) 회의부터
    // 실제로 재현된다. EPIPE는 실패의 결과일 뿐이므로 여기서 흡수하고, 진짜 원인은 위
    // 콜백이 리포트하게 둔다.
    child.stdin!.on('error', () => {})
    child.stdin!.end(stdin)
  })
