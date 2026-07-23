import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { EnvReport } from '../shared/types'

const execFileP = promisify(execFile)

export type CommandExists = (cmd: string) => Promise<boolean>

export const systemCommandExists: CommandExists = async (cmd) => {
  try {
    await execFileP('which', [cmd])
    return true
  } catch {
    return false
  }
}

export function modelFilePath(userDataDir: string, modelName: string): string {
  return path.join(userDataDir, 'models', modelName)
}

// 개발 모드에서는 appRoot=프로젝트 루트라 resources/bin/ 그대로지만,
// electron-builder의 extraResources(resources/bin → {resourcesPath}/bin)는 패키징 후
// 'resources' 세그먼트를 떼어내므로 두 후보를 모두 확인해야 dev·packaged 양쪽을 지원한다.
export function bundledWhisperPath(appRoot: string): string {
  return path.join(appRoot, 'resources', 'bin', 'whisper-cli')
}

function whisperCandidates(appRoot: string): string[] {
  return [bundledWhisperPath(appRoot), path.join(appRoot, 'bin', 'whisper-cli')]
}

// 우선순위: 번들 바이너리 존재 → 그 절대경로, 없으면 PATH의 whisper-cli, 둘 다 없으면 null.
export async function resolveWhisperCli(deps: {
  appRoot: string
  fileExists: (p: string) => boolean
  commandExists: CommandExists
}): Promise<string | null> {
  const bundled = whisperCandidates(deps.appRoot).find(deps.fileExists)
  if (bundled) return bundled
  if (await deps.commandExists('whisper-cli')) return 'whisper-cli'
  return null
}

export async function checkEnv(deps: {
  commandExists: CommandExists
  modelPath: string
  repoRoot: string
  appRoot: string
  fileExists: (p: string) => boolean
}): Promise<EnvReport> {
  const [git, claude, whisperCli] = await Promise.all([
    deps.commandExists('git'),
    deps.commandExists('claude'),
    resolveWhisperCli({ appRoot: deps.appRoot, fileExists: deps.fileExists, commandExists: deps.commandExists }),
  ])
  return { git, claude, whisper: whisperCli !== null, model: deps.fileExists(deps.modelPath), repoRoot: deps.repoRoot }
}
