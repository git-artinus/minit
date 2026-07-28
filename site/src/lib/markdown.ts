import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

// 릴리즈 노트 본문을 HTML로 변환한다.
//
// marked는 v8부터 sanitize 옵션이 없고 raw HTML·javascript: URL을 그대로 통과시킨다.
// 릴리즈 본문은 메인테이너가 쓰는 것이 관행이지만, GitHub "Generate release notes"
// 버튼이 외부 기여자의 PR 제목을 본문에 그대로 넣으므로 write 권한 전제는 깨진다.
// git-artinus.github.io 는 조직 Pages의 공유 오리진이라 여기서 XSS가 성립하면
// 같은 오리진의 다른 레포 페이지까지 영향을 받는다. 그래서 sanitize한다.
export function renderReleaseBody(markdown: string): string {
  const html = marked.parse(markdown, { async: false })
  return DOMPurify.sanitize(html)
}
