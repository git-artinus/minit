import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { ensureShellPath } from './shell-path'
import { createTray } from './tray'
import { sweepArchive, ARCHIVE_TTL_MS } from './audio-archive'

let appQuitting = false

// X로 닫아도 창은 hide로만 숨겨 살아 있다(close 핸들러 참고) — Dock 클릭·재실행 등 모든
// "다시 열기" 진입점은 새 창 생성이 아니라 이 복원 경로를 타야 한다. 최소화 해제·전면
// 포커스까지 묶어야 다른 앱 뒤에 가려진 창도 실제로 사용자 앞에 나타난다.
function revealWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 창을 닫아도 앱은 종료하지 않고 트레이에 상주한다(트레이 배선은 이후 태스크).
  mainWindow.on('close', (e) => {
    if (!appQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// 단일 인스턴스 보장(whenReady 이전에 걸어야 유효하다). 트레이 상주 앱이라 창을 닫아도
// 프로세스가 살아 있는데, 락이 없으면 Windows/Linux에서 앱을 다시 실행할 때 두 번째
// 인스턴스가 통째로 뜬다(트레이 아이콘 중복·설정 파일 경쟁). 재실행 시도는 기존
// 인스턴스의 second-instance로 전달해 창 복원으로 대응한다.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

app.on('second-instance', () => {
  if (mainWindow) revealWindow(mainWindow)
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // GUI 앱은 launchd의 최소 PATH를 물려받아 로그인 셸에만 있는 claude·git을 못 찾을 수 있다.
  // registerIpc/createWindow보다 먼저 로그인 셸 PATH를 병합해야 이후의 execFile 호출이 안전하다.
  await ensureShellPath()

  // 저장 후 보존된 녹음 원본(webm)을 TTL 경과분만 정리한다(재현 코퍼스·후속 복구용).
  sweepArchive(join(app.getPath('userData'), 'audio-archive'), ARCHIVE_TTL_MS, Date.now())

  // Set app user model id for windows
  electronApp.setAppUserModelId('dev.artinus.minit')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  const win = createWindow()
  mainWindow = win
  const tray = createTray({
    onStart: () => {
      revealWindow(win)
      win.webContents.send('tray:command', 'start-meeting')
    },
    onStop: () => win.webContents.send('tray:command', 'stop-meeting'),
    onOpen: () => revealWindow(win),
    onQuit: () => {
      appQuitting = true
      app.quit()
    }
  })
  registerIpc(win, {
    onRecordingState: (r) => tray.setRecording(r),
    // 자동 업데이트 설치 직전 종료 가드 해제 — quitAndInstall이 창을 닫을 때 실제 종료가 되도록
    // appQuitting을 세운다(안 하면 창이 트레이로 hide되어 설치가 행에 걸림).
    onBeforeInstall: () => {
      appQuitting = true
    }
  })

  app.on('activate', function () {
    // macOS에서 Dock 클릭·앱 재실행 시 호출된다. X로 닫은 창은 파괴가 아니라 hide 상태라
    // getAllWindows()가 1을 반환한다 — "창이 없으면 생성"만 하던 기존 코드는 이 경우 아무
    // 것도 하지 않아 창이 다시 나타나지 않았다. 숨겨진 창은 복원하고, 정말 없을 때만 만든다.
    if (mainWindow && !mainWindow.isDestroyed()) {
      revealWindow(mainWindow)
    } else if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('before-quit', () => {
  appQuitting = true
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
