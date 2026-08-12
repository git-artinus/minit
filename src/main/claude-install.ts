/**
 * Claude CLI 설치를 앱 안에서 실행한다. 명령은 공식 문서의 native installer이고
 * (shared/claude-cli.ts) 셸을 거쳐야 하므로 파이프가 그대로 살아 있는 형태로 spawn한다.
 *
 * 출력을 화면과 로그 파일 양쪽에 흘려보낸다. 이 레포에는 파일 로거가 없어
 * (pipeline/summary-error.ts 참고) 패키징된 앱의 stderr는 사용자가 회수할 수 없다 —
 * 설치는 네트워크·권한·기존 설치 충돌로 다양하게 실패하는데, 화면을 닫는 순간 원인이
 * 사라지면 "설치 실패" 한 줄만 남는다.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 네트워크가 죽으면 curl이 응답을 영원히 기다릴 수 있다. 넘기면 중단하고 실패로 알린다 —
 * 자식을 남겨두면 아무도 결과를 받지 않는 프로세스가 앱이 닫힐 때까지 산다.
 */
export const INSTALL_LIMIT_MS = 600_000

// 출력은 자르지 않고 그대로 흘려보낸다 — 로그 파일에는 전문이 남아야 하고, 화면에 몇 줄을
// 유지할지는 표시 문제라 렌더러가 정한다(state/setup-logic.ts의 appendInstallLog).

export type ClaudeInstallResult = { ok: true } | { ok: false; detail: string }

export interface ClaudeInstallHandlers {
  onChunk: (chunk: string) => void
  onExit: (code: number | null) => void
  onError: (e: Error) => void
}

export interface ClaudeInstallDeps {
  spawnInstall: (handlers: ClaudeInstallHandlers) => { kill: () => void }
  /** 화면으로 흘려보낼 출력. */
  onOutput: (chunk: string) => void
  onDone: (result: ClaudeInstallResult) => void
  /** 로그 파일에 남길 출력. 실패해도 설치를 막지 않는다(호출자가 삼킨다). */
  appendLog: (chunk: string) => void
  setTimer: (ms: number, fn: () => void) => () => void
  limitMs?: number
}

export interface ClaudeInstaller {
  start: (deps: ClaudeInstallDeps) => void
  cancel: () => void
}

/**
 * 실제 자식 프로세스로 설치 명령을 돌리는 spawnInstall 구현. ipc.ts에 인라인으로 두지 않는
 * 이유는 이 부분이 테스트로 덮어야 하는 곳이기 때문이다 — 셸 경유·양쪽 스트림 수집·종료
 * 코드 전달이 전부 여기서 정해진다(ipc.ts는 값만 넘기는 배선으로 남긴다).
 */
/**
 * 파이프라인 전체를 종료한다. 설치 명령은 `curl … | bash`라서 셸이 자식을 둘 fork하는데,
 * 셸에만 시그널을 보내면 오른쪽(bash)이 부모를 잃고 설치를 끝까지 진행한다(실측 확인) —
 * 그러면 [취소]와 상한이 사실상 무동작이 되고, 세션 가드가 이후 출력을 화면·로그 양쪽에서
 * 버리므로 무슨 일이 벌어졌는지 기록조차 남지 않는다.
 *
 * 그룹 단위로 보내려면 자식이 자기 프로세스 그룹의 리더여야 하므로 detached로 띄운다.
 * 대가로 앱이 먼저 죽으면 설치가 계속 진행된다 — 설치는 끝나는 편이 나으므로 받아들인다.
 */
function killTree(child: ChildProcess): void {
  const { pid } = child
  if (pid === undefined) return
  if (process.platform === 'win32') {
    // Windows에는 프로세스 그룹 시그널이 없다 — 트리 종료는 taskkill이 담당한다.
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {})
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    // 이미 끝났거나 그룹이 없다. 자식만이라도 시도한다.
    try {
      child.kill()
    } catch {
      /* 무시 */
    }
  }
}

export function nodeSpawnInstall(
  shell: { cmd: string; args: string[] },
  cwd: string
): ClaudeInstallDeps['spawnInstall'] {
  return (handlers) => {
    // stdin은 쓰지 않는다 — 설치 스크립트에 넘길 입력이 없다.
    // detached는 취소를 위한 것이다(killTree 참고).
    const child = spawn(shell.cmd, shell.args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })
    // 설치 스크립트는 진행 상황을 stderr에 쓰는 경우가 많다(curl의 진행률이 그렇다) —
    // 한쪽만 읽으면 화면이 빈 채로 몇 분이 흐른다.
    child.stdout.on('data', (b: Buffer) => handlers.onChunk(b.toString()))
    child.stderr.on('data', (b: Buffer) => handlers.onChunk(b.toString()))
    child.on('error', handlers.onError)
    child.on('close', (code) => handlers.onExit(code))
    return { kill: () => killTree(child) }
  }
}

/**
 * 로그 파일 기록기. 기록 실패가 설치를 멈추게 하면 안 되므로 전부 삼킨다 —
 * 로그는 진단 보조이고, 실패해도 화면 출력은 그대로 나온다.
 */
export function fileInstallLog(
  logPath: string,
  io: Pick<typeof fs, 'mkdirSync' | 'writeFileSync' | 'appendFileSync'> = fs
): { reset: (header: string) => void; append: (chunk: string) => void } {
  // path.dirname을 쓴다 — '/'를 직접 찾으면 Windows 경로(구분자 '\')에서 파일명 한 글자만
  // 떼어낸 문자열이 나와(실측) 엉뚱한 디렉터리를 만든다. shell-path.ts도 같은 방식이다.
  const dir = path.dirname(logPath)
  return {
    // 이전 시도의 기록을 남겨두면 이번 실패를 지난 실패로 오진하게 된다.
    reset: (header) => {
      try {
        io.mkdirSync(dir, { recursive: true })
        io.writeFileSync(logPath, header)
      } catch {
        /* 무시 */
      }
    },
    append: (chunk) => {
      try {
        io.appendFileSync(logPath, chunk)
      } catch {
        /* 무시 */
      }
    }
  }
}

/**
 * 세션 카운터로 경합·취소를 가른다(github/login-session.ts·claude-login.ts와 같은 패턴) —
 * 무효화된 설치의 종료는 어떤 부수효과도 남기지 않는다.
 */
export function createClaudeInstaller(): ClaudeInstaller {
  let current = 0
  let killCurrent: (() => void) | null = null

  const invalidate = (): void => {
    current++
    killCurrent?.()
    killCurrent = null
  }

  const start = (deps: ClaudeInstallDeps): void => {
    invalidate()
    const session = current
    let settled = false
    let clearLimit: (() => void) | null = null

    const finish = (result: ClaudeInstallResult): void => {
      // 상한 kill이 종료를 유발해 onExit이 다시 불린다 — 두 번 통지하면 화면이 성공 뒤에
      // 실패를 받는 순서 역전이 가능해진다.
      if (settled || session !== current) return
      settled = true
      clearLimit?.()
      deps.onDone(result)
    }

    const child = deps.spawnInstall({
      onChunk: (chunk) => {
        if (session !== current) return
        deps.onOutput(chunk)
        deps.appendLog(chunk)
      },
      onExit: (code) =>
        finish(
          code === 0
            ? { ok: true }
            : { ok: false, detail: `설치 명령이 exit code ${code ?? '없음'}으로 끝났습니다.` }
        ),
      // spawn 자체가 실패하면 종료 이벤트가 오지 않는다 — 여기서 끝내지 않으면 영구히 '설치 중'이 된다.
      onError: (e) => finish({ ok: false, detail: `설치를 시작하지 못했습니다: ${e.message}` })
    })
    killCurrent = () => child.kill()

    clearLimit = deps.setTimer(deps.limitMs ?? INSTALL_LIMIT_MS, () => {
      child.kill()
      finish({
        ok: false,
        detail: `제한 시간(${Math.round((deps.limitMs ?? INSTALL_LIMIT_MS) / 60000)}분)을 넘겨 중단했습니다.`
      })
    })
  }

  return { start, cancel: invalidate }
}
