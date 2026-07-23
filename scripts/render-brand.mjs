// SVG → PNG 렌더 파이프라인 (Electron 활용, 외부 도구 설치 없음)
//
// 배경 투명도 확보 방법: BrowserWindow에서 capturePage()로 캡처하면 배경이 검정으로
// 나오는 경우가 있어(플랫폼별 컴포지팅 차이), 대신 renderer 컨텍스트 안에서
// <canvas>에 SVG 이미지를 drawImage 후 canvas.toDataURL('image/png')로 직접 PNG를
// 뽑아 main으로 반환받는 방식을 쓴다. 캔버스는 그 자체로 독립된 픽셀 버퍼라
// 윈도우가 화면에 그려지는지 여부와 무관하게 투명 알파를 그대로 보존한다.
//
// 산출물:
//   1) build/icon.iconset/*.png — macOS 앱 아이콘 규격 전세트 (badge.svg 기반)
//   2) build/tray/*.png — 트레이(메뉴바) template 아이콘 16/32px (tray-idle/recording 기반)
import { app, BrowserWindow } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const brandDir = path.join(root, 'resources/brand')
const iconsetDir = path.join(root, 'build/icon.iconset')
const trayDir = path.join(root, 'build/tray')

// macOS iconset 규격: [파일명, 픽셀 크기]
const APP_ICON_SIZES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

// 트레이 template 아이콘: [소스 svg 이름, 출력 파일명, 픽셀 크기]
const TRAY_ICONS = [
  ['tray-idle.svg', 'tray-idle-16.png', 16],
  ['tray-idle.svg', 'tray-idle-32.png', 32],
  ['tray-recording.svg', 'tray-recording-16.png', 16],
  ['tray-recording.svg', 'tray-recording-32.png', 32]
]

// 루트 <svg>의 width/height 속성을 목표 픽셀 크기로 치환한다.
// viewBox는 그대로 유지되므로 비율은 보존되고, Image가 처음부터 목표 해상도로
// 디코드/래스터라이즈되어 canvas 확대에 따른 흐려짐이 없다.
function svgForSize(svgText, size) {
  return svgText.replace(
    /<svg([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/,
    `<svg$1 width="${size}" height="${size}"`
  )
}

async function renderPngDataUrl(win, svgText, size) {
  const svgSized = svgForSize(svgText, size)
  const svgB64 = Buffer.from(svgSized, 'utf8').toString('base64')
  const js = `
    (async () => {
      const img = new Image()
      img.src = 'data:image/svg+xml;base64,${svgB64}'
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = () => reject(new Error('svg image load failed'))
      })
      const canvas = document.createElement('canvas')
      canvas.width = ${size}
      canvas.height = ${size}
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, ${size}, ${size})
      ctx.drawImage(img, 0, 0, ${size}, ${size})
      return canvas.toDataURL('image/png')
    })()
  `
  return win.webContents.executeJavaScript(js)
}

async function savePng(dataUrl, outPath) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, Buffer.from(base64, 'base64'))
}

// 렌더된 PNG가 순수 검정+알파(template 규격)인지 검증한다.
// nativeImage.toBitmap()은 BGRA 순서의 raw 픽셀을 반환하며, 알파가 있는 픽셀은
// R=G=B=0(검정)이어야 한다(허용 오차 2, 안티앨리어싱 반올림 대비).
function assertBlackAlphaOnly(bitmap, label) {
  let maxDeviation = 0
  for (let i = 0; i < bitmap.length; i += 4) {
    const [b, g, r, a] = [bitmap[i], bitmap[i + 1], bitmap[i + 2], bitmap[i + 3]]
    if (a === 0) continue
    maxDeviation = Math.max(maxDeviation, b, g, r)
  }
  if (maxDeviation > 2) {
    throw new Error(`${label}: 알파가 있는 픽셀에서 순수 검정이 아닌 값 발견 (max=${maxDeviation})`)
  }
  console.log(`  [검증 OK] ${label}: 검정+알파만 존재 (max RGB deviation=${maxDeviation})`)
}

async function main() {
  await app.whenReady()
  const win = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: false }
  })
  win.setBackgroundColor('#00000000')
  await win.loadURL('data:text/html,<html><body style="margin:0;background:transparent"></body></html>')

  console.log('== 앱 아이콘 iconset 생성 (badge.svg) ==')
  const badgeSvg = await readFile(path.join(brandDir, 'badge.svg'), 'utf8')
  for (const [name, size] of APP_ICON_SIZES) {
    const dataUrl = await renderPngDataUrl(win, badgeSvg, size)
    const outPath = path.join(iconsetDir, name)
    await savePng(dataUrl, outPath)
    console.log(`  ${name} (${size}px) 생성 완료`)
  }

  console.log('== 트레이 아이콘 생성 (tray-idle.svg / tray-recording.svg) ==')
  for (const [srcName, outName, size] of TRAY_ICONS) {
    const svgText = await readFile(path.join(brandDir, srcName), 'utf8')
    const dataUrl = await renderPngDataUrl(win, svgText, size)
    const outPath = path.join(trayDir, outName)
    await savePng(dataUrl, outPath)
    console.log(`  ${outName} (${size}px) 생성 완료`)

    const { nativeImage } = await import('electron')
    const img = nativeImage.createFromPath(outPath)
    assertBlackAlphaOnly(img.toBitmap(), outName)
  }

  win.destroy()
  app.exit(0)
}

main().catch((e) => {
  console.error(e)
  app.exit(1)
})
