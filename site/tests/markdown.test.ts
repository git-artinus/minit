import { describe, expect, test } from 'vitest'
import { renderReleaseBody } from '../src/lib/markdown'

describe('renderReleaseBody', () => {
  test('릴리즈 노트 서식(굵게·목록·헤딩)을 HTML로 변환한다', () => {
    const html = renderReleaseBody('## ✨ 새 기능\n\n- **회의록 삭제** — 설명')
    expect(html).toContain('<h2')
    expect(html).toContain('<strong>회의록 삭제</strong>')
    expect(html).toContain('<li>')
  })

  test('이벤트 핸들러가 붙은 raw HTML을 제거한다', () => {
    const html = renderReleaseBody('<img src=x onerror="alert(1)">')
    expect(html).not.toContain('onerror')
  })

  test('javascript: 스킴 링크를 제거한다', () => {
    const html = renderReleaseBody('<a href="javascript:alert(2)">클릭</a>')
    expect(html).not.toContain('javascript:')
  })

  test('script 태그를 제거한다', () => {
    expect(renderReleaseBody('<script>alert(1)</script>')).not.toContain('<script>')
  })

  test('빈 문자열을 안전하게 처리한다', () => {
    expect(renderReleaseBody('')).toBe('')
  })

  // 아래 벡터들은 현재 DOMPurify 기본 설정으로 이미 막힌다. 그 사실을 테스트로 고정해,
  // 나중에 누가 ALLOWED_TAGS·ADD_TAGS 를 넓히면 여기서 걸리게 한다.
  test.each([
    ['iframe', '<iframe src="https://evil.example"></iframe>', 'iframe'],
    ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>', 'srcdoc'],
    ['object', '<object data="https://evil.example"></object>', 'object'],
    ['embed', '<embed src="https://evil.example">', 'embed'],
    ['svg 내부 script', '<svg><script>alert(1)</script></svg>', 'script'],
    ['svg onload', '<svg onload="alert(1)"></svg>', 'onload'],
    ['form formaction', '<form><button formaction="javascript:alert(1)">x</button></form>', 'formaction'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">', 'http-equiv'],
    ['base 태그', '<base href="javascript:alert(1)">', '<base'],
    ['data: 스킴 링크', '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', 'data:text/html']
  ])('%s 를 제거한다', (_name, input, forbidden) => {
    expect(renderReleaseBody(input)).not.toContain(forbidden)
  })

  // style 은 XSS가 아니라 열람 사실 유출 벡터다 — 페이지를 여는 순간 외부로 요청이 나간다.
  test('style 속성을 제거한다 (원격 리소스 요청 차단)', () => {
    const html = renderReleaseBody('<div style="background:url(https://attacker.example/x)">x</div>')
    expect(html).not.toContain('style=')
    expect(html).not.toContain('attacker.example')
  })

  test('정상 마크다운은 sanitize 후에도 그대로 남는다', () => {
    const html = renderReleaseBody(
      '## 🐛 버그픽스\n\n- **증상** — 설명\n  - 하위 항목\n\n`inline code` 와 [링크](https://github.com/git-artinus/minit)'
    )
    expect(html).toContain('<strong>증상</strong>')
    expect(html).toContain('<code>inline code</code>')
    expect(html).toContain('href="https://github.com/git-artinus/minit"')
    expect(html).toContain('<ul>')
  })
})
