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
})
