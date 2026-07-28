import { describe, expect, test } from 'vitest'
import { ClaudeRunError, runWithStdin } from '../../../src/main/pipeline/claude-run'

async function expectRunError(
  cmd: string,
  args: string[],
  stdin: string,
  timeoutMs?: number
): Promise<ClaudeRunError> {
  try {
    await runWithStdin(cmd, args, stdin, timeoutMs)
  } catch (e) {
    if (e instanceof ClaudeRunError) return e
    throw new Error(`ClaudeRunError가 아니다: ${String(e)}`)
  }
  throw new Error('실패해야 하는데 성공했다')
}

describe('runWithStdin', () => {
  test('성공하면 stdout을 돌려준다', async () => {
    const { stdout } = await runWithStdin('sh', ['-c', 'cat'], '트랜스크립트')
    expect(stdout).toBe('트랜스크립트')
  })

  // 회귀 방지: stdin에 error 리스너가 없으면 여기서 unhandled EPIPE가 나 프로세스가 죽는다.
  // 파이프 버퍼(64KB)를 넘겨야 재현되므로 100KB를 쓴다 — 실제로는 약 780세그먼트(1시간 이상)
  // 회의가 이 크기이며, claude는 미인증이면 stdin을 읽지 않고 즉시 종료한다.
  test('자식이 stdin을 안 읽고 죽어도 프로세스가 살아 있고 정상 reject된다', async () => {
    const big = 'x'.repeat(100_000)
    const err = await expectRunError('sh', ['-c', 'echo "Not logged in"; exit 1'], big)
    expect(err.exitCode).toBe(1)
    expect(err.stdout).toContain('Not logged in')
  })

  test('종료 코드는 exitCode에, spawnCode는 비운다', async () => {
    const err = await expectRunError('sh', ['-c', 'echo out; echo err >&2; exit 3'], '')
    expect(err.exitCode).toBe(3)
    expect(err.spawnCode).toBeNull()
    expect(err.timedOut).toBe(false)
    // 실패해도 stdout을 보존한다 — claude는 원인을 stdout에 쓴다.
    expect(err.stdout.trim()).toBe('out')
    expect(err.stderr.trim()).toBe('err')
  })

  test('실행 파일이 없으면 spawnCode=ENOENT, exitCode는 비운다', async () => {
    const err = await expectRunError('minit-nonexistent-binary-xyz', [], '')
    expect(err.spawnCode).toBe('ENOENT')
    expect(err.exitCode).toBeNull()
  })

  test('제한 시간을 넘기면 timedOut=true', async () => {
    const err = await expectRunError('sh', ['-c', 'sleep 5'], '', 300)
    expect(err.timedOut).toBe(true)
    expect(err.exitCode).toBeNull()
  })
})
