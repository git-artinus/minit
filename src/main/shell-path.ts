import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// macOS GUI 앱(Finder 실행)은 launchd의 최소 PATH(/usr/bin:/bin:/usr/sbin:/sbin)를 물려받아
// 사용자 로그인 셸의 PATH(예: ~/.local/bin, /opt/homebrew/bin)를 보지 못한다.
// 터미널에서 실행하는 dev 모드는 이 문제가 없어 재현되지 않는다.

export function mergePaths(current: string, shellPath: string): string {
  const split = (value: string): string[] => value.split(':').filter((segment) => segment.length > 0)
  const seen = new Set<string>()
  const result: string[] = []
  for (const dir of [...split(shellPath), ...split(current)]) {
    if (seen.has(dir)) continue
    seen.add(dir)
    result.push(dir)
  }
  return result.join(':')
}

export type RunShellCommand = (cmd: string, args: string[]) => Promise<{ stdout: string }>

export async function probeShellPath(deps: { shell: string; run: RunShellCommand }): Promise<string | null> {
  try {
    // '-ilc'(인터랙티브 로그인 셸)는 .zshrc 등 인터랙티브 rc를 실행하는데, rc가 사진·다운로드
    // 폴더 등에 접근하면 GUI 앱(Minit) 명의로 macOS TCC 권한 프롬프트가 뜬다. PATH 조회에는
    // 인터랙티브 셸이 필요 없으므로 비인터랙티브 로그인 셸('-lc')로 낮춘다.
    const { stdout } = await deps.run(deps.shell, ['-lc', 'echo -n "$PATH"'])
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export const FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', `${os.homedir()}/.local/bin`]

// 비인터랙티브 로그인 셸(-lc)도 rc 파일 로딩 등으로 느릴 수 있어, hang 방지를 위해 5초 타임아웃을 둔다.
const defaultRun: RunShellCommand = async (cmd, args) => {
  const { stdout } = await execFileP(cmd, args, { timeout: 5_000 })
  return { stdout }
}

export async function ensureShellPath(deps?: { shell?: string; run?: RunShellCommand }): Promise<void> {
  const shell = deps?.shell ?? process.env.SHELL ?? '/bin/zsh'
  const run = deps?.run ?? defaultRun
  const shellPath = await probeShellPath({ shell, run })
  // 프로브가 성공해도 사용자가 PATH 추가를 .zshrc(인터랙티브 전용)에만 해둔 경우 ~/.local/bin 등이
  // 누락될 수 있어, 프로브 성공 여부와 무관하게 FALLBACK_DIRS를 항상 후순위로 병합한다.
  const addition = shellPath ? mergePaths(FALLBACK_DIRS.join(':'), shellPath) : FALLBACK_DIRS.join(':')
  process.env.PATH = mergePaths(process.env.PATH ?? '', addition)
}
