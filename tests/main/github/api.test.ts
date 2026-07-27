import { describe, expect, test, vi } from 'vitest'
import {
  deleteRemoteMeeting,
  downloadRemoteMeeting,
  fetchViewer,
  listRemoteMeetings,
  listRepos,
  uploadMeeting
} from '../../../src/main/github/api'

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe('fetchViewer', () => {
  test('GET /user 로 로그인 계정명을 가져온다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { login: 'joel' }))
    const result = await fetchViewer('ghu_token', fetchImpl as unknown as typeof fetch)
    expect(result).toEqual({ login: 'joel' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer ghu_token' }) })
    )
  })

  test('비2xx면 throw한다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, {}))
    await expect(fetchViewer('bad', fetchImpl as unknown as typeof fetch)).rejects.toThrow(/401/)
  })

  test('타임아웃 시 reject한다', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    ) as unknown as typeof fetch

    const promise = fetchViewer('ghu_token', fetchImpl, 10_000)
    const assertion = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    vi.useRealTimers()
  })
})

describe('listRepos', () => {
  test('GET /user/repos 결과를 full_name 배열로 변환한다', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, [{ full_name: 'git-artinus/minit' }, { full_name: 'joel/side-project' }])
    )
    const result = await listRepos('ghu_token', fetchImpl as unknown as typeof fetch)
    expect(result).toEqual(['git-artinus/minit', 'joel/side-project'])
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/user/repos?per_page=100&sort=pushed',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer ghu_token' }) })
    )
  })

  test('비2xx면 throw한다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}))
    await expect(listRepos('ghu_token', fetchImpl as unknown as typeof fetch)).rejects.toThrow(/500/)
  })
})

describe('uploadMeeting', () => {
  test('기존 파일이 없으면(404) sha 없이 PUT한다', async () => {
    const fetchImpl = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') return jsonResponse(201, { content: {} })
      return jsonResponse(404, {})
    })

    await uploadMeeting('ghu_token', 'git-artinus/minit', '2026-07-22-회의.md', '내용', fetchImpl as unknown as typeof fetch)

    const putCall = fetchImpl.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT')!
    const body = JSON.parse((putCall[1] as RequestInit).body as string)
    expect(body.sha).toBeUndefined()
    expect(body.message).toBe('docs(minit): 2026-07-22-회의.md 회의록 추가')
    expect(body.content).toBe(Buffer.from('내용', 'utf-8').toString('base64'))
    expect(putCall[0]).toBe('https://api.github.com/repos/git-artinus/minit/contents/minit/2026-07-22-%ED%9A%8C%EC%9D%98.md')
  })

  test('기존 파일이 있으면 sha를 포함해 PUT한다', async () => {
    const fetchImpl = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') return jsonResponse(200, {})
      return jsonResponse(200, { sha: 'abc123' })
    })

    await uploadMeeting('ghu_token', 'git-artinus/minit', 'a.md', '내용', fetchImpl as unknown as typeof fetch)

    const putCall = fetchImpl.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT')!
    const body = JSON.parse((putCall[1] as RequestInit).body as string)
    expect(body.sha).toBe('abc123')
  })

  test('409 충돌 시 1회 재조회 후 재시도해 성공하면 throw하지 않는다', async () => {
    let putCount = 0
    const fetchImpl = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        putCount++
        return putCount === 1 ? jsonResponse(409, {}) : jsonResponse(200, {})
      }
      return jsonResponse(200, { sha: `sha-${putCount}` })
    })

    await expect(
      uploadMeeting('ghu_token', 'git-artinus/minit', 'a.md', '내용', fetchImpl as unknown as typeof fetch)
    ).resolves.toBeUndefined()
    expect(putCount).toBe(2)
  })

  test('재시도해도 실패하면 throw한다', async () => {
    const fetchImpl = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') return jsonResponse(422, {})
      return jsonResponse(200, { sha: 'abc' })
    })

    await expect(
      uploadMeeting('ghu_token', 'git-artinus/minit', 'a.md', '내용', fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/422/)
  })

  test('유효하지 않은 filename이면 네트워크 호출 없이 throw한다', async () => {
    const fetchImpl = vi.fn()
    await expect(
      uploadMeeting('ghu_token', 'git-artinus/minit', '../secret.md', '내용', fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('listRemoteMeetings', () => {
  test('GET contents/minit 결과에서 .md 파일만 name/sha로 변환한다', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, [
        { name: '2026-07-22-회의.md', sha: 'sha1', type: 'file' },
        { name: 'README', sha: 'sha2', type: 'file' },
        { name: 'sub', sha: 'sha3', type: 'dir' },
      ])
    )
    const result = await listRemoteMeetings('ghu_token', 'git-artinus/minit', fetchImpl as unknown as typeof fetch)
    expect(result).toEqual([{ name: '2026-07-22-회의.md', sha: 'sha1' }])
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/git-artinus/minit/contents/minit',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer ghu_token' }) })
    )
  })

  test('유효하지 않은(경로 이탈 등) 파일명은 방어적으로 제외한다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [{ name: '../secret.md', sha: 'sha1' }]))
    const result = await listRemoteMeetings('ghu_token', 'git-artinus/minit', fetchImpl as unknown as typeof fetch)
    expect(result).toEqual([])
  })

  test('type이 file이 아닌 항목(디렉터리 등)은 이름이 .md로 끝나도 제외한다', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, [
        { name: '2026-07-22-회의.md', sha: 'sha1', type: 'dir' },
        { name: '2026-07-23-회의.md', sha: 'sha2', type: 'file' },
      ])
    )
    const result = await listRemoteMeetings('ghu_token', 'git-artinus/minit', fetchImpl as unknown as typeof fetch)
    expect(result).toEqual([{ name: '2026-07-23-회의.md', sha: 'sha2' }])
  })

  test('폴더가 없으면(404) 빈 배열을 반환한다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {}))
    const result = await listRemoteMeetings('ghu_token', 'git-artinus/minit', fetchImpl as unknown as typeof fetch)
    expect(result).toEqual([])
  })

  test('404 외 비2xx면 throw한다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}))
    await expect(
      listRemoteMeetings('ghu_token', 'git-artinus/minit', fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/500/)
  })
})

describe('downloadRemoteMeeting', () => {
  test('base64 content를 디코드해 문자열로 반환한다', async () => {
    const fetchImpl = vi.fn(async (_url: string) =>
      jsonResponse(200, { content: Buffer.from('내용', 'utf-8').toString('base64') })
    )
    const result = await downloadRemoteMeeting('ghu_token', 'git-artinus/minit', '2026-07-22-회의.md', fetchImpl as unknown as typeof fetch)
    expect(result).toBe('내용')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/git-artinus/minit/contents/minit/2026-07-22-%ED%9A%8C%EC%9D%98.md',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer ghu_token' }) })
    )
  })

  test('비2xx면 throw한다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {}))
    await expect(
      downloadRemoteMeeting('ghu_token', 'git-artinus/minit', 'a.md', fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/404/)
  })
})

describe('deleteRemoteMeeting', () => {
  test('sha를 조회해 DELETE한다', async () => {
    const fetchImpl = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === 'DELETE') return jsonResponse(200, {})
      return jsonResponse(200, { sha: 'abc123' })
    })

    await deleteRemoteMeeting('ghu_token', 'git-artinus/minit', '2026-07-22-회의.md', fetchImpl as unknown as typeof fetch)

    const delCall = fetchImpl.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'DELETE')!
    expect(delCall[0]).toBe('https://api.github.com/repos/git-artinus/minit/contents/minit/2026-07-22-%ED%9A%8C%EC%9D%98.md')
    const body = JSON.parse((delCall[1] as RequestInit).body as string)
    expect(body).toEqual({ message: 'docs(minit): 2026-07-22-회의.md 회의록 삭제', sha: 'abc123' })
  })

  test('원격에 파일이 없으면(404) DELETE 없이 성공으로 끝낸다', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {}))

    await expect(
      deleteRemoteMeeting('ghu_token', 'git-artinus/minit', 'a.md', fetchImpl as unknown as typeof fetch)
    ).resolves.toBeUndefined()
    // sha 조회 1회로 끝 — 뒤따르는 DELETE 요청이 없었다는 뜻이다.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('DELETE가 비2xx면 throw한다', async () => {
    const fetchImpl = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === 'DELETE') return jsonResponse(409, {})
      return jsonResponse(200, { sha: 'abc123' })
    })

    await expect(
      deleteRemoteMeeting('ghu_token', 'git-artinus/minit', 'a.md', fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/409/)
  })

  test('유효하지 않은 filename이면 네트워크 호출 없이 throw한다', async () => {
    const fetchImpl = vi.fn()
    await expect(
      deleteRemoteMeeting('ghu_token', 'git-artinus/minit', '../secret.md', fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
