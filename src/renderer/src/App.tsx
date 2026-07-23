import { useEffect, useState } from 'react'
import { MeetingsProvider } from './state/meetings'
import { SetupProvider } from './state/setup'
import { Sidebar } from './components/Sidebar'
import { MeetingDetail } from './components/MeetingDetail'
import { SetupPanel } from './components/SetupPanel'
import { SettingsModal } from './components/SettingsModal'
import { SlackPromptModal } from './components/SlackPromptModal'
import { GithubPromptModal } from './components/GithubPromptModal'
import { UpdateBanner } from './components/UpdateBanner'
import './theme.css'

export default function App(): React.JSX.Element {
  const [theme, setTheme] = useState<string>(
    () =>
      localStorage.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [slackPromptOpen, setSlackPromptOpen] = useState(false)
  const [githubPromptOpen, setGithubPromptOpen] = useState(false)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.theme = theme
  }, [theme])

  const maybeOpenSlackPrompt = (): void => {
    window.minuting
      .getSettings()
      .then((s) => {
        if (!s.slackPromptShown) setSlackPromptOpen(true)
      })
      .catch(() => {})
  }

  // 최초 1회 온보딩 안내(v0.3.0 ①③) — GitHub 연결 안내가 Slack 안내보다 먼저 뜬다(동시에 두
  // 모달을 띄우지 않는다). GitHub가 이미 로그인돼 있거나 이미 안내를 봤으면 곧바로 Slack 안내로 넘어간다.
  useEffect(() => {
    Promise.all([window.minuting.getSettings(), window.minuting.getGithubLoginState()])
      .then(([s, gh]) => {
        if (!gh.loggedIn && !s.githubPromptShown) {
          setGithubPromptOpen(true)
        } else {
          maybeOpenSlackPrompt()
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회만 확인한다.
  }, [])

  const dismissGithubPrompt = (): void => {
    setGithubPromptOpen(false)
    window.minuting
      .updateSettings({ githubPromptShown: true })
      .catch(() => {})
      .finally(() => maybeOpenSlackPrompt())
  }

  const dismissSlackPrompt = (): void => {
    setSlackPromptOpen(false)
    window.minuting.updateSettings({ slackPromptShown: true }).catch(() => {})
  }

  const connectSlackFromPrompt = (): void => {
    dismissSlackPrompt()
    setSettingsOpen(true)
  }

  return (
    <SetupProvider>
      <MeetingsProvider>
        <div className="app">
          <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
          <main className="detail">
            <MeetingDetail />
          </main>
        </div>
        {/* repoRoot 변경 시 목록 새로고침은 SettingsModal 내부에서 useMeetings().refresh를
            직접 호출한다(brief 대안 채택) — App은 콜백 prop 없이 open/close와 theme만 넘긴다. */}
        <SettingsModal
          open={settingsOpen}
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => setSettingsOpen(false)}
        />
        {slackPromptOpen && (
          <SlackPromptModal onConnect={connectSlackFromPrompt} onLater={dismissSlackPrompt} />
        )}
        {githubPromptOpen && <GithubPromptModal onDone={dismissGithubPrompt} />}
        {/* 자동 업데이트 알림(v0.4.0 ③b) — 메인 UI와 병행 렌더, 새 버전이 있을 때만 나타난다.
            설치 가드(리뷰 Fix Critical)가 녹음 중 여부(useMeetings)를 읽어야 해서 MeetingsProvider
            안으로 옮겼다. */}
        <UpdateBanner />
      </MeetingsProvider>
      {/* 온보딩 비차단화(v0.3.0 ①) — 메인 UI와 병행 렌더, 구성 완료 시 자동으로 사라진다. */}
      <SetupPanel />
    </SetupProvider>
  )
}
