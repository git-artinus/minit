import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi, type Mock } from 'vitest'
import {
  createClaudeInstaller,
  fileInstallLog,
  INSTALL_LIMIT_MS,
  nodeSpawnInstall,
  type ClaudeInstallDeps,
  type ClaudeInstallResult
} from '../../src/main/claude-install'

interface Harness {
  deps: ClaudeInstallDeps
  kill: Mock
  onOutput: Mock
  onDone: Mock
  appendLog: Mock
  clearTimer: Mock
  emit: (chunk: string) => void
  exit: (code: number | null) => void
  fail: (message: string) => void
  fireTimer: () => void
}

function harness(over: Partial<ClaudeInstallDeps> = {}): Harness {
  let onChunk: (c: string) => void = () => {}
  let onExit: (code: number | null) => void = () => {}
  let onError: (e: Error) => void = () => {}
  let fireTimer: () => void = () => {}
  const kill = vi.fn()
  const clearTimer = vi.fn()
  const onOutput = vi.fn()
  const onDone = vi.fn()
  const appendLog = vi.fn()

  const deps: ClaudeInstallDeps = {
    spawnInstall: (handlers) => {
      onChunk = handlers.onChunk
      onExit = handlers.onExit
      onError = handlers.onError
      return { kill }
    },
    onOutput,
    onDone,
    appendLog,
    setTimer: (_ms, fn) => {
      fireTimer = fn
      return clearTimer
    },
    ...over
  }
  return {
    deps,
    kill,
    onOutput,
    onDone,
    appendLog,
    clearTimer,
    emit: (chunk) => onChunk(chunk),
    exit: (code) => onExit(code),
    fail: (message) => onError(new Error(message)),
    fireTimer: () => fireTimer()
  }
}

describe('createClaudeInstaller', () => {
  test('출력을 그대로 흘려보내고 로그에도 남긴다', () => {
    const h = harness()
    createClaudeInstaller().start(h.deps)

    h.emit('downloading…\n')

    // 화면이 닫혀도 원인이 남아야 한다 — 이 레포에는 파일 로거가 없다.
    expect(h.onOutput).toHaveBeenCalledWith('downloading…\n')
    expect(h.appendLog).toHaveBeenCalledWith('downloading…\n')
  })

  test('exit 0이면 성공으로 끝난다', () => {
    const h = harness()
    createClaudeInstaller().start(h.deps)

    h.exit(0)

    expect(h.onDone).toHaveBeenCalledWith({ ok: true })
  })

  test('non-zero exit는 코드를 실어 실패로 끝난다', () => {
    const h = harness()
    createClaudeInstaller().start(h.deps)

    h.exit(1)

    expect(h.onDone).toHaveBeenCalledWith({ ok: false, detail: expect.stringContaining('1') })
  })

  // sh 자체가 없거나 spawn이 막힌 경우. 종료 이벤트가 오지 않으므로 여기서 끝내야 한다.
  test('spawn 실패는 사유를 실어 실패로 끝난다', () => {
    const h = harness()
    createClaudeInstaller().start(h.deps)

    h.fail('ENOENT')

    expect(h.onDone).toHaveBeenCalledWith({ ok: false, detail: expect.stringContaining('ENOENT') })
  })

  test('완료되면 타이머를 해제한다', () => {
    const h = harness()
    createClaudeInstaller().start(h.deps)

    h.exit(0)

    expect(h.clearTimer).toHaveBeenCalledTimes(1)
  })

  // 상한 kill이 exit을 유발해 onExit이 또 불린다 — 결과가 두 번 나가면 화면이 성공 뒤에
  // 실패를 받는 순서 역전이 가능해진다.
  test('결과는 한 번만 통지한다', () => {
    const h = harness()
    createClaudeInstaller().start(h.deps)

    h.exit(0)
    h.exit(1)

    expect(h.onDone).toHaveBeenCalledTimes(1)
  })

  test('취소하면 자식을 죽이고 결과를 통지하지 않는다', () => {
    const h = harness()
    const installer = createClaudeInstaller()
    installer.start(h.deps)

    installer.cancel()
    h.exit(null)

    expect(h.kill).toHaveBeenCalledTimes(1)
    expect(h.onDone).not.toHaveBeenCalled()
  })

  // 네트워크가 죽으면 curl이 영원히 매달릴 수 있다 — 자식이 남으면 앱을 닫을 때까지 산다.
  test('상한을 넘기면 죽이고 실패로 끝낸다', () => {
    const h = harness()
    createClaudeInstaller().start(h.deps)

    h.fireTimer()

    expect(h.kill).toHaveBeenCalledTimes(1)
    expect(h.onDone).toHaveBeenCalledWith({
      ok: false,
      detail: expect.stringContaining('제한 시간')
    })
  })

  test('새 start는 이전 설치를 무효화한다', () => {
    const first = harness()
    const second = harness()
    const installer = createClaudeInstaller()

    installer.start(first.deps)
    installer.start(second.deps)

    first.exit(0)
    expect(first.onDone).not.toHaveBeenCalled()
    expect(first.kill).toHaveBeenCalledTimes(1)

    second.exit(0)
    expect(second.onDone).toHaveBeenCalledWith({ ok: true })
  })

  test('상한은 10분이다', () => {
    expect(INSTALL_LIMIT_MS).toBe(600_000)
  })
})

// 실제 자식 프로세스를 돌린다. 위 테스트들은 주입된 spawn으로 세션 로직만 보므로,
// 셸 경유·양쪽 스트림 수집·종료 코드 전달이 실제로 되는지는 여기서만 드러난다.
// 설치 명령 대신 echo를 쓴다 — 진짜 install.sh는 이 기기의 claude를 덮어쓴다.
describe('nodeSpawnInstall — 실제 프로세스', () => {
  const sh = (script: string): { cmd: string; args: string[] } => ({
    cmd: '/bin/sh',
    args: ['-c', script]
  })

  function run(script: string): Promise<{ output: string; result: ClaudeInstallResult }> {
    return new Promise((resolve) => {
      let output = ''
      createClaudeInstaller().start({
        spawnInstall: nodeSpawnInstall(sh(script), tmpdir()),
        onOutput: (c) => (output += c),
        appendLog: () => {},
        onDone: (result) => resolve({ output, result }),
        setTimer: (_ms, fn) => {
          const t = setTimeout(fn, 5000)
          return () => clearTimeout(t)
        }
      })
    })
  }

  test('stdout을 받아 성공으로 끝낸다', async () => {
    const { output, result } = await run('echo 첫째줄; echo 둘째줄')

    expect(output).toContain('첫째줄')
    expect(output).toContain('둘째줄')
    expect(result).toEqual({ ok: true })
  })

  // curl은 진행률을 stderr에 쓴다 — 이걸 놓치면 화면이 빈 채로 몇 분이 흐른다.
  test('stderr도 함께 받는다', async () => {
    const { output } = await run('echo 진행률 1>&2')

    expect(output).toContain('진행률')
  })

  test('non-zero exit는 실패로 끝낸다', async () => {
    const { result } = await run('echo 실패직전; exit 3')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.detail).toContain('3')
  })

  // 셸을 거치지 않으면 파이프가 인자 문자열이 된다 — 실제 설치 명령이 파이프를 쓴다.
  test('파이프가 셸에서 해석된다', async () => {
    const { output, result } = await run('echo hello | tr a-z A-Z')

    expect(output).toContain('HELLO')
    expect(result).toEqual({ ok: true })
  })

  test('실행할 수 없는 명령은 error 경로로 실패한다', async () => {
    const { result } = await new Promise<{ result: ClaudeInstallResult }>((resolve) => {
      createClaudeInstaller().start({
        spawnInstall: nodeSpawnInstall({ cmd: '/존재하지-않는-실행파일', args: [] }, tmpdir()),
        onOutput: () => {},
        appendLog: () => {},
        onDone: (result) => resolve({ result }),
        setTimer: () => () => {}
      })
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.detail).toContain('시작하지 못했습니다')
  })
})

describe('fileInstallLog', () => {
  test('reset은 이전 기록을 지우고 append는 이어 쓴다', () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'minit-install-log-'))
    const file = path.join(dir, 'install.log')
    const log = fileInstallLog(file)

    log.reset('머리말\n')
    log.append('첫째\n')
    log.append('둘째\n')
    expect(fs.readFileSync(file, 'utf-8')).toBe('머리말\n첫째\n둘째\n')

    // 지난 실패가 이번 실패로 읽히면 진단이 어긋난다.
    log.reset('새 시도\n')
    expect(fs.readFileSync(file, 'utf-8')).toBe('새 시도\n')

    fs.rmSync(dir, { recursive: true, force: true })
  })

  // 로그는 진단 보조다. 기록이 안 된다고 설치를 막으면 본래 목적을 잃는다.
  test('기록이 실패해도 던지지 않는다', () => {
    const throwing = {
      mkdirSync: () => {
        throw new Error('권한 없음')
      },
      writeFileSync: () => {
        throw new Error('권한 없음')
      },
      appendFileSync: () => {
        throw new Error('권한 없음')
      }
    } as unknown as typeof fs
    const log = fileInstallLog('/못쓰는/경로/install.log', throwing)

    expect(() => log.reset('머리말')).not.toThrow()
    expect(() => log.append('본문')).not.toThrow()
  })
})

// 취소·상한이 실제로 멈추는지. 주입 테스트로는 원리적으로 볼 수 없다 — kill이 셸에만
// 닿는지 파이프라인 전체에 닿는지는 실제 프로세스에서만 드러난다(실측으로 회귀를 겪었다).
describe('nodeSpawnInstall — 취소가 파이프라인 전체를 멈춘다', () => {
  test('kill 후 파이프 오른쪽이 계속 실행되지 않는다', async () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'minit-kill-'))
    const marker = path.join(dir, 'MARKER')
    // 실제 설치 명령과 같은 모양: 왼쪽이 스크립트를 흘려보내고 오른쪽 셸이 오래 돈다.
    const spawnInstall = nodeSpawnInstall(
      { cmd: '/bin/sh', args: ['-c', `echo "sleep 0.4; touch ${marker}" | /bin/sh`] },
      dir
    )
    const installer = createClaudeInstaller()
    installer.start({
      spawnInstall,
      onOutput: () => {},
      appendLog: () => {},
      onDone: () => {},
      setTimer: () => () => {}
    })

    await new Promise((r) => setTimeout(r, 60))
    installer.cancel()
    await new Promise((r) => setTimeout(r, 900))

    // 살아 있으면 사용자는 취소했는데 원격 스크립트가 설치를 끝까지 진행한다.
    const survived = fs.existsSync(marker)
    fs.rmSync(dir, { recursive: true, force: true })
    expect(survived).toBe(false)
  }, 10_000)
})

describe('fileInstallLog — 경로 구분자', () => {
  function recordingIo(made: string[]): typeof fs {
    return {
      mkdirSync: (d: string) => void made.push(d),
      writeFileSync: () => {},
      appendFileSync: () => {}
    } as unknown as typeof fs
  }

  test('실행 플랫폼 규칙으로 상위 디렉터리를 만든다', () => {
    const made: string[] = []
    const logPath = path.join('minit-home', '.minit', 'install-claude.log')

    fileInstallLog(logPath, recordingIo(made)).reset('머리말')

    expect(made).toEqual([path.join('minit-home', '.minit')])
  })

  // 구분자를 직접 찾으면 Windows에서 파일명 한 글자만 뗀 문자열이 디렉터리가 된다(실측).
  // 실패는 삼켜지므로 로그가 안 생기는데 화면은 경로를 안내한다. 이 테스트는 macOS에서
  // 돌아도 그 회귀를 잡는다 — 실행 플랫폼의 path 구현으로는 재현할 수 없기 때문이다.
  test('경로 분해를 손으로 구현하지 않는다', () => {
    const src = fs.readFileSync(
      new URL('../../src/main/claude-install.ts', import.meta.url),
      'utf-8'
    )
    expect(src).not.toMatch(/lastIndexOf\(['"][/\\]['"]\)/)
  })
})
