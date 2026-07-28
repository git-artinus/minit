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

/** 이 블록 동안 발생한 uncaughtException을 모은다(vitest 리포터에 의존하지 않고 직접 단언한다). */
async function collectUncaught(run: () => Promise<unknown>): Promise<Error[]> {
  const caught: Error[] = []
  const onUncaught = (e: Error): void => {
    caught.push(e)
  }
  process.on('uncaughtException', onUncaught)
  try {
    await run()
  } finally {
    // EPIPE는 프로미스 정착 직전에 도착하지만, 한 틱 양보해 늦은 이벤트까지 받는다.
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.removeListener('uncaughtException', onUncaught)
  }
  return caught
}

const BIG_STDIN = 'x'.repeat(100_000)

describe('runWithStdin', () => {
  test('성공하면 stdout을 돌려준다', async () => {
    const { stdout } = await runWithStdin('sh', ['-c', 'cat'], '트랜스크립트')
    expect(stdout).toBe('트랜스크립트')
  })

  test('큰 입력도 온전히 왕복한다', async () => {
    const { stdout } = await runWithStdin('sh', ['-c', 'cat'], BIG_STDIN)
    expect(stdout).toHaveLength(BIG_STDIN.length)
  })

  // 상태 확인 프로브가 쓰는 조합이다(빈 stdin + stdin을 읽지 않는 자식). 성공 판정이
  // writableFinished에 달려 있어, 빈 입력을 "끝까지 못 넘겼다"로 보면 프로브만 전수 실패한다.
  test('빈 stdin은 자식이 읽지 않아도 성공으로 처리한다', async () => {
    const { stdout } = await runWithStdin('sh', ['-c', 'echo ok'], '')
    expect(stdout.trim()).toBe('ok')
  })

  // 회귀 방지: stdin에 error 리스너가 없으면 여기서 unhandled EPIPE가 나 main 프로세스가 죽는다.
  // OS 파이프 버퍼(darwin 최대 64KB)를 넘겨야 재현되므로 100KB를 쓴다. vitest 리포터에 기대지
  // 않고 uncaughtException을 직접 잡아 단언한다 — 리스너를 등록하면 리포터 폴백이 사라지므로
  // 이 단언이 유일한 안전망이다.
  test('자식이 stdin을 안 읽고 죽어도 uncaughtException이 발생하지 않는다', async () => {
    let err: ClaudeRunError | null = null
    const uncaught = await collectUncaught(async () => {
      err = await expectRunError('sh', ['-c', 'echo "Not logged in"; exit 1'], BIG_STDIN)
    })
    expect(uncaught).toEqual([])
    expect(err!.run.exitCode).toBe(1)
    expect(err!.run.stdout).toContain('Not logged in')
  })

  // stdin을 다 못 넘겼는데 자식이 exit 0으로 끝나면, 그 요약은 트랜스크립트 일부만 본 결과다.
  // 성공으로 통과시키면 부분 입력 요약이 경고 없이 저장·커밋·발송된다.
  //
  // 한계: 입력이 파이프 버퍼에 다 들어가면 쓰기는 성공하므로 감지할 수 없다(Node는 "썼는지"만
  // 알 수 있고 "자식이 읽었는지"는 알 수 없다). 실측상 100KB는 감지 불가, 1MB부터 감지된다 —
  // 위험한 쪽(긴 회의)이 감지되는 방향이라 수용한다.
  test('stdin을 끝까지 못 넘겼으면 exit 0이어도 실패로 처리한다', async () => {
    const err = await expectRunError(
      'sh',
      ['-c', 'head -c 10 >/dev/null; echo \'{"summary":"부분"}\''],
      'x'.repeat(1_000_000)
    )
    expect(err.run.stdinFailed).toBe(true)
    expect(err.run.exitCode).toBe(0)
  })

  test('큰 입력을 자식이 전부 읽으면 오탐 없이 성공한다', async () => {
    const { stdout } = await runWithStdin(
      'sh',
      ['-c', 'cat > /dev/null; echo ok'],
      'x'.repeat(1_000_000)
    )
    expect(stdout.trim()).toBe('ok')
  })

  test('종료 코드는 exitCode에, errorCode는 비운다', async () => {
    const err = await expectRunError('sh', ['-c', 'echo out; echo err >&2; exit 3'], '')
    expect(err.run.exitCode).toBe(3)
    expect(err.run.errorCode).toBeNull()
    expect(err.timedOut).toBe(false)
    // 실패해도 stdout을 보존한다 — claude는 원인을 stdout에 쓴다.
    expect(err.run.stdout.trim()).toBe('out')
    expect(err.run.stderr.trim()).toBe('err')
  })

  test('실행 파일이 없으면 errorCode=ENOENT, exitCode는 비운다', async () => {
    const err = await expectRunError('minit-nonexistent-binary-xyz', [], '')
    expect(err.run.errorCode).toBe('ENOENT')
    expect(err.run.exitCode).toBeNull()
  })

  test('제한 시간을 넘기면 timedOut=true이고 signal을 보존한다', async () => {
    const err = await expectRunError('sh', ['-c', 'sleep 5'], '', 300)
    expect(err.timedOut).toBe(true)
    expect(err.run.signal).toBe('SIGTERM')
    expect(err.run.exitCode).toBeNull()
  })

  // signal을 버리면 SIGKILL(메모리 부족 등)이 "출력 없는 실패"로 뭉개져 진단이 불가능해진다.
  test('외부 시그널로 죽으면 signal을 남기고 timedOut은 false다', async () => {
    const err = await expectRunError('sh', ['-c', 'kill -KILL $$'], '')
    expect(err.run.signal).toBe('SIGKILL')
    expect(err.timedOut).toBe(false)
  })

  test('message에 최소 단서를 담는다(분류기를 안 거치는 핸들러 대비)', async () => {
    const err = await expectRunError('sh', ['-c', 'exit 3'], '')
    expect(err.message).toContain('exit 3')
  })
})
