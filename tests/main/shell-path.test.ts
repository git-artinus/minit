import { afterEach, describe, expect, test } from 'vitest'
import {
  FALLBACK_DIRS,
  ensureShellPath,
  fileShellPathCache,
  mergePaths,
  probeShellPath,
  toolsResolvable,
} from '../../src/main/shell-path'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('mergePaths', () => {
  test('양쪽에 중복된 경로는 하나만 남긴다', () => {
    expect(mergePaths('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin')).toBe('/opt/homebrew/bin:/usr/bin:/bin')
  })

  test('순서를 보존하되 shellPath 쪽 항목이 우선한다', () => {
    expect(mergePaths('/usr/bin:/bin', '/a:/b')).toBe('/a:/b:/usr/bin:/bin')
  })

  test('빈 항목(연속 콜론·선후행 콜론)은 제거한다', () => {
    expect(mergePaths('/usr/bin::/bin:', ':/a:')).toBe('/a:/usr/bin:/bin')
  })

  test('current가 빈 문자열이면 shellPath만 남는다', () => {
    expect(mergePaths('', '/a:/b')).toBe('/a:/b')
  })

  test('shellPath가 빈 문자열이면 current만 남는다', () => {
    expect(mergePaths('/usr/bin:/bin', '')).toBe('/usr/bin:/bin')
  })
})

describe('probeShellPath', () => {
  test('run이 PATH 문자열을 반환하면 trim된 값을 반환한다', async () => {
    const result = await probeShellPath({
      shell: '/bin/zsh',
      run: async () => ({ stdout: '  /a:/b  \n' }),
    })
    expect(result).toBe('/a:/b')
  })

  test('run이 로그인 셸을 실행하기 위한 인자로 호출된다', async () => {
    let received: { cmd: string; args: string[] } | null = null
    await probeShellPath({
      shell: '/bin/zsh',
      run: async (cmd, args) => {
        received = { cmd, args }
        return { stdout: '/a' }
      },
    })
    expect(received).toEqual({ cmd: '/bin/zsh', args: ['-lc', 'echo -n "$PATH"'] })
  })

  test('run이 throw하면 null을 반환한다', async () => {
    const result = await probeShellPath({
      shell: '/bin/zsh',
      run: async () => {
        throw new Error('boom')
      },
    })
    expect(result).toBeNull()
  })

  test('stdout이 빈 문자열(trim 후)이면 null을 반환한다', async () => {
    const result = await probeShellPath({
      shell: '/bin/zsh',
      run: async () => ({ stdout: '   ' }),
    })
    expect(result).toBeNull()
  })
})

describe('ensureShellPath', () => {
  const originalPath = process.env.PATH
  // 실제 ~/.minit/shell-path-cache.json을 읽지 않도록 캐시 없음 상태를 고정한다.
  const noCache = { read: (): string | null => null, write: (): void => {} }

  afterEach(() => {
    process.env.PATH = originalPath
  })

  test('probeShellPath 성공 시 shell PATH가 process.env.PATH에 병합된다(FALLBACK_DIRS도 후순위로 병합)', async () => {
    process.env.PATH = '/usr/bin:/bin'
    await ensureShellPath({
      cache: noCache,
      shell: '/bin/zsh',
      run: async () => ({ stdout: '/opt/homebrew/bin:/usr/bin' }),
    })
    expect(process.env.PATH).toBe(
      ['/opt/homebrew/bin', '/usr/bin', ...FALLBACK_DIRS.filter((dir) => dir !== '/opt/homebrew/bin'), '/bin'].join(
        ':',
      ),
    )
  })

  test('probeShellPath가 성공했지만 ~/.local/bin이 누락된 경우에도 최종 PATH에 포함된다', async () => {
    process.env.PATH = '/usr/bin:/bin'
    const localBin = FALLBACK_DIRS[FALLBACK_DIRS.length - 1]
    // 프로브(-lc)는 성공하지만, 사용자가 PATH를 .zshrc(인터랙티브 전용)에서만 추가해 localBin이 누락된 상황을 재현한다.
    await ensureShellPath({
      cache: noCache,
      shell: '/bin/zsh',
      run: async () => ({ stdout: '/opt/homebrew/bin:/usr/bin' }),
    })
    expect(process.env.PATH!.split(':')).toContain(localBin)
  })

  test('probeShellPath 실패 시 FALLBACK_DIRS가 병합된다', async () => {
    process.env.PATH = '/usr/bin:/bin'
    await ensureShellPath({
      cache: noCache,
      shell: '/bin/zsh',
      run: async () => {
        throw new Error('boom')
      },
    })
    expect(process.env.PATH).toBe([...FALLBACK_DIRS, '/usr/bin', '/bin'].join(':'))
  })

  test('기존 PATH에 이미 있는 항목은 dedupe된다', async () => {
    process.env.PATH = `/usr/bin:${FALLBACK_DIRS[0]}`
    await ensureShellPath({
      cache: noCache,
      shell: '/bin/zsh',
      run: async () => {
        throw new Error('boom')
      },
    })
    expect(process.env.PATH).toBe([...FALLBACK_DIRS, '/usr/bin'].join(':'))
  })
})

describe('toolsResolvable', () => {
  test('모든 도구가 PATH 디렉토리 중 하나에서 발견되면 true', () => {
    const exists = (p: string): boolean => p === '/a/claude' || p === '/b/git'
    expect(toolsResolvable('/a:/b', exists)).toBe(true)
  })

  test('하나라도 없으면 false', () => {
    const exists = (p: string): boolean => p === '/a/claude'
    expect(toolsResolvable('/a:/b', exists)).toBe(false)
  })

  test('빈 PATH 항목은 무시한다', () => {
    expect(toolsResolvable('::', () => true)).toBe(false)
  })
})

describe('fileShellPathCache', () => {
  test('write → read 왕복: 저장한 shellPath를 그대로 돌려준다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minit-shellpath-'))
    try {
      const cache = fileShellPathCache(path.join(tempDir, 'cache.json'))
      cache.write('/opt/homebrew/bin:/usr/bin')
      expect(cache.read()).toBe('/opt/homebrew/bin:/usr/bin')
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('파일이 없으면 null', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minit-shellpath-'))
    try {
      expect(fileShellPathCache(path.join(tempDir, 'none.json')).read()).toBeNull()
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  test('손상된 JSON·잘못된 형태면 null (다음 실행에서 프로브로 복구)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minit-shellpath-'))
    try {
      const file = path.join(tempDir, 'cache.json')
      fs.writeFileSync(file, '{broken')
      expect(fileShellPathCache(file).read()).toBeNull()
      fs.writeFileSync(file, JSON.stringify({ shellPath: 123 }))
      expect(fileShellPathCache(file).read()).toBeNull()
      fs.writeFileSync(file, JSON.stringify({ shellPath: '' }))
      expect(fileShellPathCache(file).read()).toBeNull()
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })
})

describe('ensureShellPath 캐시 동작(TCC 프롬프트 억제)', () => {
  const originalPath = process.env.PATH

  afterEach(() => {
    process.env.PATH = originalPath
  })

  test('캐시 PATH로 필요한 도구가 전부 해석되면 셸을 실행하지 않는다', async () => {
    process.env.PATH = '/usr/bin'
    let shellRuns = 0
    await ensureShellPath({
      shell: '/bin/zsh',
      run: async () => {
        shellRuns++
        return { stdout: '/probed' }
      },
      cache: { read: () => '/cached', write: () => {} },
      exists: (p) => p === '/cached/claude' || p === '/usr/bin/git',
    })
    expect(shellRuns).toBe(0)
    expect(process.env.PATH!.split(':')).toContain('/cached')
    // 캐시 경로에서도 FALLBACK_DIRS는 항상 병합된다(프로브 경로와 동일 규칙).
    expect(process.env.PATH!.split(':')).toEqual(expect.arrayContaining(FALLBACK_DIRS))
  })

  test('캐시가 있어도 도구가 해석되지 않으면 프로브로 내려가 캐시를 갱신한다', async () => {
    process.env.PATH = '/usr/bin'
    let written: string | null = null
    await ensureShellPath({
      shell: '/bin/zsh',
      run: async () => ({ stdout: '/probed' }),
      cache: { read: () => '/stale', write: (v) => { written = v } },
      exists: () => false,
    })
    expect(written).toBe('/probed')
    expect(process.env.PATH!.split(':')).toContain('/probed')
  })

  test('캐시가 없으면 프로브하고 성공 결과를 캐시에 쓴다', async () => {
    process.env.PATH = '/usr/bin'
    let written: string | null = null
    await ensureShellPath({
      shell: '/bin/zsh',
      run: async () => ({ stdout: '/probed' }),
      cache: { read: () => null, write: (v) => { written = v } },
    })
    expect(written).toBe('/probed')
  })

  test('프로브가 실패하면 캐시를 쓰지 않는다', async () => {
    process.env.PATH = '/usr/bin'
    let writeCalls = 0
    await ensureShellPath({
      shell: '/bin/zsh',
      run: async () => {
        throw new Error('boom')
      },
      cache: { read: () => null, write: () => { writeCalls++ } },
    })
    expect(writeCalls).toBe(0)
    expect(process.env.PATH).toBe([...FALLBACK_DIRS, '/usr/bin'].join(':'))
  })
})
