import { Menu, Tray, nativeImage, type NativeImage } from 'electron'

// macOS 템플릿 아이콘(검정+알파만) — Soundlines 글리프 축약판을 base64 데이터 URL로 임베드한다.
// 16px(@1x)·32px(@2x) 두 해상도를 addRepresentation으로 함께 등록해 레티나 디스플레이에 대응한다.
// (resources/brand/tray-idle.svg / tray-recording.svg → scripts/render-brand.mjs로 생성.
//  재생성: npm run render:brand)
const IDLE_ICON_16_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAtUlEQVR4AaSSgQ3CMAwEA7vAXrAIsAjsBcPAXSQqp7FKaCtfnNrfr6tmXzZevwye+Aspj2hwQiKkKQ7shJRHNLgjEdJiOJFUUTSohYHFiaRK1xjUB7/LGoMXDwuplGhwpiKkxTjSFVJr8KAipCl8k0yF+SZOMO9575vEfUo08Ne8UY2gFmn7CbXw7xIncNQdBiOoRVqav+AxvlLNsEerjziBx/iCJMMerT6igWfghiTDHq0+PgAAAP//IoUt5wAAAAZJREFUAwASoiPjESS51wAAAABJRU5ErkJggg=='
const IDLE_ICON_32_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABW0lEQVR4AeyVQbLCMAxDgQ1ckyUnYsk1YQV+nXqSgApxEwrM8CemSr4lq6amm9WH/37awN6adx4DbDC+WjpwtHLbMcAG46vFAMW9Yo79rOqqDNDO5tZWVbckZYB2ckcE2NKa1tMbUgYo7BVz7GfRKzeBDgEu+MpAkdBhQ2GXyfFwtoSBodDUx9/AEh24ZO3P8XCsDORJOR4IMz4OxkGHANs2LWWAJJIJcMqeh05G240BNpiWMkDSJCFR+yBloFaZDnlujv2s6tpigK+HwgS4quB9UouBLl9Vi4H7m5m1Vwb87XU1xZ7BKx5tk01LGeCN9fDSSJTZCE20CwFloEh490YZ4Inmye5dG020C11lwJ/utWX2DH7c0DbZtJSB9N8F0FcaYFQYmegIwoEb6pvqAKPCyISELBkOXIP1SxmoZ3fIVAYYFUYmKg8HboinDDAqjEx0BOHALQy82twAAAD//1412QQAAAAGSURBVAMAMZlOQWMWZFgAAAAASUVORK5CYII='
const RECORDING_ICON_16_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAq0lEQVR4AbSQ3Q3CMBCDA+zCXvCEYAhgCBBPDMYu/Hymfcjp4ipS1eqcXuw7y8q6zPwWNbgR7j1CPW0ul0ALR8alC+rFQcWSGJnhdhh+4WxxxRmEzamLM3g0llqcTXDC4A4+I9SL4xrLJdCUFjY0gnraXFMGebrB1AYv9G8nNMtosW/wF3uOOsGWhVUnNMtoCQl2MBcDaUi56gRP5LOBNKRctcEe+WogDSnXDwAA//+sMk/OAAAABklEQVQDACPmI+MuIAMPAAAAAElFTkSuQmCC'
const RECORDING_ICON_32_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABaUlEQVR4AeyWzU0DUQyEgQv0QQNALxw4cqQAKAIK4MiRA70ADdAHXID5oqw2q8xqPcrLn5TIzntrj8cjay3tydGWfwcBezuBe7067/LfuXMnpsfM0gmci55mjzov5cdz506MHBiFa5YKeBMtzXRYIwfGJl0wEcCIaeB4FmNgwC7GRu+JgJtRluVEGZsIuFjuMxopYxMBo91WSSQCPoNGZWwi4DUQUMYmAp4k4EM+ZWDATuFm+UQABdf6o4EOa+TA2KQLpgK+RHIlf5DT7E8nzp0YOTAK1ywV0LEyYppRj3Mn1uXLJ8Vl8DqABwFuArca9becl6ulwwm3qHtzAp6VPpW3NjjhHvA6AQPAuh+cgDs1/ZG3NjjhHvA6AS9CnMm7z61WJ5xwi7o3J6DPbuC2kwJYFVYmXUFqqI3m5ibAqrAyEZHA1FCra92cgHp1A6QTwKqwMik9NdRGdU4Aq8LKpOtHDbUDAVMP/wAAAP//YXxicgAAAAZJREFUAwA17UxBjbpRAQAAAABJRU5ErkJggg=='

function templateIcon(dataUrl1x: string, dataUrl2x: string): NativeImage {
  const img = nativeImage.createEmpty()
  img.addRepresentation({ scaleFactor: 1, dataURL: `data:image/png;base64,${dataUrl1x}` })
  img.addRepresentation({ scaleFactor: 2, dataURL: `data:image/png;base64,${dataUrl2x}` })
  img.setTemplateImage(true)
  return img
}

export function createTray(deps: {
  onStart: () => void
  onStop: () => void
  onOpen: () => void
  onQuit: () => void
}): { setRecording: (recording: boolean) => void } {
  const idleIcon = templateIcon(IDLE_ICON_16_B64, IDLE_ICON_32_B64)
  const recordingIcon = templateIcon(RECORDING_ICON_16_B64, RECORDING_ICON_32_B64)
  const tray = new Tray(idleIcon)
  let recording = false
  const rebuild = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        recording
          ? { label: '회의 종료', click: deps.onStop }
          : { label: '회의 시작', click: deps.onStart },
        { label: 'Minit 열기', click: deps.onOpen },
        { type: 'separator' },
        { label: '종료', click: deps.onQuit }
      ])
    )
    tray.setImage(recording ? recordingIcon : idleIcon)
    tray.setToolTip(recording ? 'Minit — 녹음 중' : 'Minit')
  }
  rebuild()
  return {
    setRecording: (r) => {
      recording = r
      rebuild()
    }
  }
}
