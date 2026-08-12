import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { CLAUDE_DOCS_URL, claudeInstallCommand, claudeInstallShell } from '../../src/shared/claude-cli'

describe('claudeInstallCommand', () => {
  // 공식 문서가 Recommended로 제시하는 native installer다. npm 방식은 Node 22+를 요구하고
  // 문서에서 Advanced로 내려갔다 — 기본 안내가 그쪽이면 설치 실패를 자초한다.
  test('macOS·Linux는 install.sh를 curl로 받아 실행한다', () => {
    for (const p of ['darwin', 'linux'] as const) {
      expect(claudeInstallCommand(p)).toBe('curl -fsSL https://claude.ai/install.sh | bash')
    }
  })

  // PowerShell은 curl·bash가 없다. 같은 문자열을 쓰면 Windows에서 설치가 통째로 실패한다.
  test('Windows는 PowerShell 방식을 쓴다', () => {
    expect(claudeInstallCommand('win32')).toBe('irm https://claude.ai/install.ps1 | iex')
  })

  // 모르는 플랫폼에 Windows 명령을 주면 더 나쁘다 — POSIX 쪽이 기본값이다.
  test('알 수 없는 플랫폼은 POSIX 명령으로 떨어진다', () => {
    expect(claudeInstallCommand('freebsd')).toBe(claudeInstallCommand('linux'))
  })

  // 이 파일은 렌더러도 import한다. 렌더러에는 nodeIntegration이 꺼져 있어 process가 없어서,
  // 모듈 최상위에서 process를 읽으면 'process is not defined'로 화면이 통째로 죽는다(실측).
  // 플랫폼은 preload가 window.minuting.platform으로 넘긴다.
  test('모듈이 process를 참조하지 않는다', () => {
    const src = readFileSync(new URL('../../src/shared/claude-cli.ts', import.meta.url), 'utf8')
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toContain('process.')
  })
})

describe('claudeInstallShell', () => {
  // 파이프(|)가 있어 셸을 거쳐야 한다. execFile로 직접 실행하면 파이프가 인자 문자열이 된다.
  test('macOS·Linux는 sh -c로 실행한다', () => {
    expect(claudeInstallShell('darwin')).toEqual({
      cmd: '/bin/sh',
      args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash']
    })
  })

  // -NoProfile: 사용자 프로필 스크립트가 설치 출력에 섞이거나 실행을 막지 않게 한다.
  test('Windows는 powershell -NoProfile -Command로 실행한다', () => {
    expect(claudeInstallShell('win32')).toEqual({
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-Command', 'irm https://claude.ai/install.ps1 | iex']
    })
  })
})

describe('CLAUDE_DOCS_URL', () => {
  test('설치 문서를 가리킨다', () => {
    expect(CLAUDE_DOCS_URL).toMatch(/^https:\/\//)
  })
})
