import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { ensureShellPath } from './shell-path'
import { createTray } from './tray'

let appQuitting = false

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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // GUI 앱은 launchd의 최소 PATH를 물려받아 로그인 셸에만 있는 claude·git을 못 찾을 수 있다.
  // registerIpc/createWindow보다 먼저 로그인 셸 PATH를 병합해야 이후의 execFile 호출이 안전하다.
  await ensureShellPath()

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

  const mainWindow = createWindow()
  const tray = createTray({
    onStart: () => {
      mainWindow.show()
      mainWindow.webContents.send('tray:command', 'start-meeting')
    },
    onStop: () => mainWindow.webContents.send('tray:command', 'stop-meeting'),
    onOpen: () => mainWindow.show(),
    onQuit: () => {
      appQuitting = true
      app.quit()
    }
  })
  registerIpc(mainWindow, { onRecordingState: (r) => tray.setRecording(r) })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
