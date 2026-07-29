import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { minitHome } from './settings'

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

// 셸 프로브를 생략해도 되는지 판단하는 기준 — 앱이 PATH에서 찾아 실행하는 외부 도구.
// whisper-cli는 번들 바이너리가 우선이라 제외한다(env-check.resolveWhisperCli 참고).
export const REQUIRED_TOOLS = ['claude', 'git']

export function toolsResolvable(
  pathValue: string,
  exists: (p: string) => boolean,
  tools: string[] = REQUIRED_TOOLS
): boolean {
  const dirs = pathValue.split(':').filter((d) => d.length > 0)
  return tools.every((tool) => dirs.some((dir) => exists(path.join(dir, tool))))
}

export interface ShellPathCache {
  read(): string | null
  write(value: string): void
}

// 캐시는 성능이 아니라 TCC 프롬프트 억제 장치다. 로그인 셸을 띄우면 사용자 dotfile이
// Minit.app 명의로 실행돼, dotfile이 건드리는 폴더마다 권한 프롬프트가 앱 이름으로 뜬다.
// 프로브 결과를 저장해 두면 다음 실행부터는 셸 자체를 띄우지 않는다. 손상·부재 시 프로브로
// 자연 복구되므로 읽기 실패는 조용히 무시한다.
export function fileShellPathCache(file: string = path.join(minitHome(), 'shell-path-cache.json')): ShellPathCache {
  return {
    read: () => {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
        const value = (parsed as { shellPath?: unknown })?.shellPath
        return typeof value === 'string' && value.length > 0 ? value : null
      } catch {
        return null
      }
    },
    write: (value) => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify({ shellPath: value }, null, 2))
      } catch {
        // 캐시 저장 실패는 치명적이지 않다 — 다음 실행에서 프로브가 다시 돈다.
      }
    }
  }
}

export async function ensureShellPath(deps?: {
  shell?: string
  run?: RunShellCommand
  cache?: ShellPathCache
  exists?: (p: string) => boolean
}): Promise<void> {
  const shell = deps?.shell ?? process.env.SHELL ?? '/bin/zsh'
  const run = deps?.run ?? defaultRun
  const cache = deps?.cache ?? fileShellPathCache()
  const exists = deps?.exists ?? fs.existsSync

  // 캐시된 셸 PATH로 필요한 도구가 전부 해석되면 로그인 셸을 아예 띄우지 않는다.
  // 도구가 하나라도 안 풀리면(설치 경로 변경·삭제 등) 프로브로 내려가 캐시를 갱신한다.
  const cached = cache.read()
  if (cached !== null) {
    const merged = mergePaths(process.env.PATH ?? '', mergePaths(FALLBACK_DIRS.join(':'), cached))
    if (toolsResolvable(merged, exists)) {
      process.env.PATH = merged
      return
    }
  }

  const shellPath = await probeShellPath({ shell, run })
  if (shellPath !== null) cache.write(shellPath)
  // 프로브가 성공해도 사용자가 PATH 추가를 .zshrc(인터랙티브 전용)에만 해둔 경우 ~/.local/bin 등이
  // 누락될 수 있어, 프로브 성공 여부와 무관하게 FALLBACK_DIRS를 항상 후순위로 병합한다.
  const addition = shellPath ? mergePaths(FALLBACK_DIRS.join(':'), shellPath) : FALLBACK_DIRS.join(':')
  process.env.PATH = mergePaths(process.env.PATH ?? '', addition)
}
