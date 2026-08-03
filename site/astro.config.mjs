import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import { fetchAllReleases } from './src/lib/github.ts'
import { toReleaseEntries } from './src/lib/releases.ts'

// 변경 이력은 한 페이지에 모든 버전을 싣는다. 사이드바가 그 안의 버전 목록까지 맡아
// 우측 ToC 없이도 원하는 버전으로 바로 갈 수 있게 한다 — 좌측과 우측에 같은 목록을
// 두 벌 세우지 않기 위함이다.
//
// 사이드바는 내비게이션 크롬이지 내용이 아니다. 릴리즈 조회가 실패하면 빌드를 세우는
// 대신 링크 하나로 접는다 — 토큰 없는 로컬(60/h)에서 dev 서버가 통째로 막히지 않게 한다.
// 페이지 본문은 여전히 실패를 그대로 드러낸다(src/lib/github.ts 참고).
async function releaseSidebar() {
  try {
    const versions = toReleaseEntries(await fetchAllReleases())
    if (versions.length === 0) throw new Error('릴리즈 없음')
    return {
      label: '변경 이력',
      // 다른 페이지에서는 접어 둔다. Starlight는 현재 페이지를 담은 그룹을 자동으로 펴는데,
      // 해시가 붙은 링크는 현재 페이지로 쳐주지 않는다 — 최신 버전만 해시 없이 두면
      // 변경 이력에 들어왔을 때 그룹이 펴지고 그 항목이 활성으로 표시된다. 최신 버전은
      // 어차피 페이지 맨 위라 앵커가 없어도 같은 곳이다.
      collapsed: true,
      items: versions.map((r, i) => ({
        label: r.version,
        link: i === 0 ? '/changelog/' : `/changelog/#v${r.version}`
      }))
    }
  } catch {
    return { label: '릴리즈', items: [{ label: '변경 이력', link: '/changelog/' }] }
  }
}

export default defineConfig({
  site: 'https://git-artinus.github.io',
  base: '/minit/', // 끝 슬래시 필수 — BASE_URL이 그대로 반환되므로 없으면 ${base}docs/ 가 /minitdocs/ 가 된다
  integrations: [
    starlight({
      title: 'Minit',
      description: '대면 회의를 위한 회의록 앱',
      customCss: ['./src/styles/custom.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/git-artinus/minit' }],
      // 최상위 link는 그룹 라벨과 같은 들여쓰기로 그려진다 — 활성 표시(주황 바)가 문서
      // 항목과 다른 단에 걸려 페이지를 옮길 때마다 좌우로 튄다. 그룹으로 감싸 단을 맞춘다.
      sidebar: [
        { label: '문서', items: [{ autogenerate: { directory: 'docs' } }] },
        await releaseSidebar()
      ]
    })
  ],
  // 브랜드 자산(resources/brand)은 프로젝트 루트 밖에 있다. dev 서버에서만 필요한 설정이다.
  vite: { server: { fs: { allow: ['..'] } } }
})
