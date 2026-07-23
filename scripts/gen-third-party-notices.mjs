// THIRD-PARTY-NOTICES.md 생성기(v0.4.0 ③b) — npm production 의존성은 license-checker로
// 자동 수집하고, npm 밖에서 번들되는 whisper.cpp만 수동 항목으로 덧붙인다.
//
// license-checker는 CJS라 default import로 받아 .init을 호출한다. copyright는 각 패키지의
// licenseFile 첫 "Copyright" 줄을 정규식으로 추출하고, 못 찾으면 publisher로 대체한다(완전한
// SPDX copyright 파싱기는 아니지만 NOTICES 목적엔 충분하다).
import checker from 'license-checker'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function extractCopyright(pkg) {
  if (pkg.licenseFile && fs.existsSync(pkg.licenseFile)) {
    try {
      const text = fs.readFileSync(pkg.licenseFile, 'utf-8')
      const m = /copyright\s+(?:\(c\)\s*)?(.+)/i.exec(text)
      if (m) return m[0].trim()
    } catch {
      // 읽기 실패 — publisher 폴백으로 넘어간다
    }
  }
  if (pkg.publisher) return `Copyright ${pkg.publisher}`
  return '-'
}

function loadPackages() {
  return new Promise((resolve, reject) => {
    checker.init(
      { start: root, production: true, excludePackages: `${process.env.npm_package_name ?? 'minit'}` },
      (err, packages) => (err ? reject(err) : resolve(packages))
    )
  })
}

async function main() {
  const rawName = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).name
  const packages = await loadPackages()

  const rows = Object.entries(packages)
    .filter(([key]) => !key.startsWith(`${rawName}@`))
    .map(([key, pkg]) => {
      const at = key.lastIndexOf('@')
      const name = key.slice(0, at)
      const version = key.slice(at + 1)
      return {
        name,
        version,
        license: Array.isArray(pkg.licenses) ? pkg.licenses.join(', ') : String(pkg.licenses ?? 'UNKNOWN'),
        copyright: extractCopyright(pkg),
        repository: pkg.repository ?? ''
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const lines = []
  lines.push('# Third-Party Notices')
  lines.push('')
  lines.push(
    'Minit은 다음 오픈소스 소프트웨어를 사용한다. 이 문서는 `npx license-checker --production --json` 결과로 ' +
      '자동 생성되며(스크립트: `scripts/gen-third-party-notices.mjs`, `npm run notices:gen`), npm 패키지 밖에서 ' +
      '번들되는 항목만 하단에 수동으로 덧붙인다.'
  )
  lines.push('')
  lines.push('## npm 의존성 (production)')
  lines.push('')
  lines.push('| 패키지 | 버전 | 라이선스 | 저작권 |')
  lines.push('| --- | --- | --- | --- |')
  for (const r of rows) {
    lines.push(`| ${r.name} | ${r.version} | ${r.license} | ${r.copyright.replace(/\|/g, '\\|')} |`)
  }
  lines.push('')
  lines.push('## 수동 항목 (npm 패키지가 아닌 번들 구성요소)')
  lines.push('')
  lines.push('| 구성요소 | 라이선스 | 비고 |')
  lines.push('| --- | --- | --- |')
  lines.push(
    '| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT | 로컬 음성 전사(whisper-cli) 실행 파일을 ' +
      '`resources/`에 번들한다 — npm 패키지가 아니라 별도 빌드 산출물이라 license-checker가 인식하지 못한다. |'
  )
  lines.push(
    '| [Electron](https://github.com/electron/electron) | MIT | 런타임 프레임워크. 위 표에도 devDependency로 ' +
      '잡히지만 최종 배포판(dmg/exe)에 그대로 포함되는 핵심 런타임이라 별도로 명기한다. |'
  )
  lines.push('')

  fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), lines.join('\n'))
  console.log(`THIRD-PARTY-NOTICES.md 생성 완료 (${rows.length}개 npm 패키지)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
