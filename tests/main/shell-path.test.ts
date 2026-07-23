import { afterEach, describe, expect, test } from 'vitest'
import { FALLBACK_DIRS, ensureShellPath, mergePaths, probeShellPath } from '../../src/main/shell-path'

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

  afterEach(() => {
    process.env.PATH = originalPath
  })

  test('probeShellPath 성공 시 shell PATH가 process.env.PATH에 병합된다(FALLBACK_DIRS도 후순위로 병합)', async () => {
    process.env.PATH = '/usr/bin:/bin'
    await ensureShellPath({
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
      shell: '/bin/zsh',
      run: async () => ({ stdout: '/opt/homebrew/bin:/usr/bin' }),
    })
    expect(process.env.PATH!.split(':')).toContain(localBin)
  })

  test('probeShellPath 실패 시 FALLBACK_DIRS가 병합된다', async () => {
    process.env.PATH = '/usr/bin:/bin'
    await ensureShellPath({
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
      shell: '/bin/zsh',
      run: async () => {
        throw new Error('boom')
      },
    })
    expect(process.env.PATH).toBe([...FALLBACK_DIRS, '/usr/bin'].join(':'))
  })
})
