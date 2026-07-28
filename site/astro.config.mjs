import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://git-artinus.github.io',
  base: '/minit/', // 끝 슬래시 필수 — BASE_URL이 그대로 반환되므로 없으면 ${base}docs/ 가 /minitdocs/ 가 된다
  integrations: [
    starlight({
      title: 'Minit',
      description: '대면 회의를 위한 회의록 앱',
      customCss: ['./src/styles/custom.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/git-artinus/minit' }],
      sidebar: [
        { label: '문서', items: [{ autogenerate: { directory: 'docs' } }] },
        { label: '변경 이력', link: '/changelog/' }
      ]
    })
  ],
  // 브랜드 자산(resources/brand)은 프로젝트 루트 밖에 있다. dev 서버에서만 필요한 설정이다.
  vite: { server: { fs: { allow: ['..'] } } }
})
