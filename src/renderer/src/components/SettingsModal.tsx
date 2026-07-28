import { useEffect, useState } from 'react'
import type {
  AppSettings,
  GithubLoginState,
  SlackChannel,
  SlackTokenState,
  UpdateCheckResult,
  UpdateProgress
} from '../../../shared/types'
import { CLAUDE_DEPENDENCY_NOTICE, CLAUDE_DOCS_URL, CLAUDE_INSTALL_COMMAND } from '../../../shared/claude-cli'
import { useMeetings } from '../state/meetings'
import { useSetup } from '../state/setup'
import { GithubConnectFlow } from './GithubConnectFlow'
import { RosterSection } from './RosterSection'
import { SlackChannelSelect } from './SlackChannelSelect'

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// 설치 가드 오류(리뷰 Fix Critical) — main의 update:download가 canInstallUpdate 결과로 던진
// 오류 코드를 사용자 문구로 옮긴다. UpdateBanner와 동일한 매핑을 공유한다.
function installGuardMessage(e: unknown): string | null {
  const msg = errMessage(e)
  if (msg.includes('recording_in_progress')) return '녹음 중에는 업데이트할 수 없습니다. 회의 종료 후 다시 시도하세요.'
  if (msg.includes('pipeline_in_progress')) return '회의록 처리 중입니다. 완료 후 다시 시도하세요.'
  return null
}

// 설계 노트: repoRoot 변경 후 목록 새로고침 트리거는 별도 onRepoRootChanged prop을
// App→Sidebar로 넘기지 않고, 이 컴포넌트가 MeetingsProvider 하위에서 렌더되는 점을
// 이용해 useMeetings().refresh를 직접 호출한다(brief에서 허용한 대안). open=false일
// 때도 이 컴포넌트 자체는 항상 마운트돼 있으므로(널 반환은 훅 호출 이후) 훅 규칙 위반이 없다.
export function SettingsModal(props: {
  open: boolean
  theme: string
  onThemeChange: (t: string) => void
  onClose: () => void
}): React.JSX.Element | null {
  const { refresh } = useMeetings()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 업데이트 확인(v0.4.0 ③b) — updateResult: null=아직 확인 안 함, checkForUpdate 결과를 그대로 담는다.
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  // Slack — 토큰(암호화 저장, 원문은 절대 렌더러로 오지 않는다)·채널 선택(v0.4.0 ②)
  const [slackToken, setSlackToken] = useState<SlackTokenState | null>(null)
  const [slackTokenEditing, setSlackTokenEditing] = useState(false)
  const [slackTokenInput, setSlackTokenInput] = useState('')
  const [slackChannels, setSlackChannels] = useState<SlackChannel[] | null>(null)
  const [slackChannelsLoading, setSlackChannelsLoading] = useState(false)
  const [slackError, setSlackError] = useState<string | null>(null)

  // Claude CLI 상태(#8) — which claude 결과를 그대로 쓴다(사용량을 소모하는 사전 스모크 테스트는
  // 하지 않는다). env는 SetupProvider가 단일 소스로 들고 있다 — 각자 조회하면 이 화면과 설치
  // 패널이 서로 다른 상태를 보여준다.
  const { env, envError, rechecking: envChecking, recheck: recheckClaude } = useSetup()
  const [installCopied, setInstallCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  const [github, setGithub] = useState<GithubLoginState | null>(null)
  const [githubConnecting, setGithubConnecting] = useState(false)
  const [githubRepos, setGithubRepos] = useState<string[] | null>(null)
  const [githubError, setGithubError] = useState<string | null>(null)

  useEffect(() => {
    if (!props.open) return
    setError(null)
    setSlackError(null)
    setSlackTokenEditing(false)
    setSlackTokenInput('')
    setSlackChannels(null)
    setGithubError(null)
    setGithubConnecting(false)
    setGithubRepos(null)
    setUpdateChecking(false)
    setUpdateResult(null)
    setUpdateDownloading(false)
    setUpdateProgress(null)
    setUpdateError(null)
    setInstallCopied(false)
    setCopyError(null)
    window.minuting.getSettings().then(setSettings).catch(() => {})
    window.minuting.getAppVersion().then(setVersion).catch(() => {})
    window.minuting.getGithubLoginState().then(setGithub).catch(() => {})
    window.minuting.getSlackTokenState().then(setSlackToken).catch(() => {})
  }, [props.open])

  useEffect(() => {
    const off = window.minuting.onUpdateProgress(setUpdateProgress)
    return () => {
      off()
    }
  }, [])

  // 실제 조회 자체(setState는 오직 프로미스 콜백 안에서만 — 이펙트 본문에서 직접 동기적으로
  // setState하지 않기 위함). 새로고침 버튼(loadSlackChannels)과 자동 최초 조회 이펙트가 공유한다.
  const fetchSlackChannels = (): void => {
    window.minuting
      .listSlackChannels()
      .then((channels) => {
        setSlackChannels(channels)
        setSlackChannelsLoading(false)
      })
      .catch((e) => {
        setSlackError('채널 목록을 불러오지 못했습니다: ' + errMessage(e))
        setSlackChannelsLoading(false)
      })
  }

  const loadSlackChannels = (): void => {
    setSlackChannelsLoading(true)
    setSlackError(null)
    fetchSlackChannels()
  }

  // GitHub 레포 선택(loadGithubRepoOptions)과 동일한 지연 로딩 관례 — 드롭다운을 처음 열 때(focus)
  // 아직 목록이 없으면 조용히 조회한다(로딩 표시는 수동 새로고침 버튼 전용).
  const loadSlackChannelOptions = (): void => {
    if (slackChannels) return
    fetchSlackChannels()
  }

  // 토큰이 등록된 상태로 열렸으면(또는 새로 저장했으면) 채널 목록을 한 번 조회해 둔다. 배경 자동
  // 조회라 로딩 스피너 없이 조용히 fetchSlackChannels만 호출한다(로딩 표시는 수동 새로고침 전용).
  useEffect(() => {
    if (!props.open || !slackToken?.saved || slackChannels !== null) return
    fetchSlackChannels()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slackToken.saved가 true로 바뀔 때만 반응한다.
  }, [props.open, slackToken?.saved])

  if (!props.open) return null

  const updateAutoPush = async (autoPush: boolean): Promise<void> => {
    try {
      setError(null)
      const updated = await window.minuting.updateSettings({ autoPush })
      setSettings(updated)
    } catch (e) {
      setError('설정을 저장하지 못했습니다: ' + errMessage(e))
    }
  }

  const updateGithubSync = async (githubSync: boolean): Promise<void> => {
    try {
      setGithubError(null)
      const updated = await window.minuting.updateSettings({ githubSync })
      setSettings(updated)
    } catch (e) {
      setGithubError('자동 동기화 설정을 저장하지 못했습니다: ' + errMessage(e))
    }
  }

  const pickRepoRoot = async (): Promise<void> => {
    try {
      setError(null)
      const dir = await window.minuting.pickFolder()
      if (!dir) return
      const updated = await window.minuting.updateSettings({ repoRoot: dir })
      setSettings(updated)
      refresh()
    } catch (e) {
      setError('설정을 저장하지 못했습니다: ' + errMessage(e))
    }
  }

  const resetRepoRootToDefault = async (): Promise<void> => {
    if (!settings) return
    try {
      setError(null)
      const updated = await window.minuting.updateSettings({ repoRoot: settings.defaultRepoRoot })
      setSettings(updated)
      refresh()
    } catch (e) {
      setError('설정을 저장하지 못했습니다: ' + errMessage(e))
    }
  }

  const saveSlackToken = async (): Promise<void> => {
    setSlackError(null)
    const trimmed = slackTokenInput.trim()
    if (trimmed === '') {
      setSlackError('토큰을 입력하세요.')
      return
    }
    try {
      const state = await window.minuting.saveSlackToken(trimmed)
      setSlackToken(state)
      setSlackTokenEditing(false)
      setSlackTokenInput('')
      setSlackChannels(null) // 새 토큰 — 다른 워크스페이스일 수 있으므로 채널 목록을 다시 조회한다.
    } catch {
      setSlackError('봇 토큰(xoxb-로 시작) 형식이 올바르지 않습니다.')
    }
  }

  const clearSlackToken = async (): Promise<void> => {
    setSlackError(null)
    try {
      await window.minuting.clearSlackToken()
      setSlackToken({ saved: false })
      setSlackChannels(null)
      setSettings((s) => (s ? { ...s, slackChannelId: null, slackChannelName: null } : s))
    } catch {
      setSlackError('연동 해제에 실패했습니다.')
    }
  }

  const selectSlackChannel = async (channel: SlackChannel): Promise<void> => {
    setSlackError(null)
    try {
      const updated = await window.minuting.selectSlackChannel(channel.id, channel.name)
      setSettings(updated)
    } catch (e) {
      setSlackError('채널 선택에 실패했습니다: ' + errMessage(e))
    }
  }

  const loadGithubRepoOptions = (): void => {
    if (githubRepos) return
    window.minuting
      .listGithubRepos()
      .then(setGithubRepos)
      .catch(() => setGithubRepos([]))
  }

  const changeGithubRepo = async (repo: string): Promise<void> => {
    setGithubError(null)
    try {
      const updated = await window.minuting.updateSettings({ githubRepo: repo || null })
      setSettings(updated)
      setGithub((g) => (g ? { ...g, repo: repo || null } : g))
    } catch {
      setGithubError('저장소 설정을 저장하지 못했습니다.')
    }
  }

  const finishGithubConnect = (): void => {
    setGithubConnecting(false)
    setGithubRepos(null)
    window.minuting.getGithubLoginState().then(setGithub).catch(() => {})
    // 레포를 처음 선택했다면 main이 githubSync를 자동으로 켰을 수 있다 — 최신 설정을 다시 읽는다.
    window.minuting.getSettings().then(setSettings).catch(() => {})
  }

  const logoutGithub = async (): Promise<void> => {
    setGithubError(null)
    try {
      await window.minuting.githubLogout()
      setGithub({ loggedIn: false, repo: null })
      setGithubRepos(null)
      window.minuting.getSettings().then(setSettings).catch(() => {})
    } catch {
      setGithubError('로그아웃에 실패했습니다.')
    }
  }

  // 렌더러가 file:// 오리진으로 로드될 때 navigator.clipboard가 막히므로 메인을 경유한다
  // (공유 기능이 writeClipboard를 도입한 것과 같은 이유).
  const copyInstallCommand = (): void => {
    setCopyError(null)
    window.minuting.writeClipboard(CLAUDE_INSTALL_COMMAND).then(
      () => {
        setInstallCopied(true)
        // 되돌리지 않으면 '복사됨'이 고정돼 두 번째 복사가 됐는지 알 수 없다.
        window.setTimeout(() => setInstallCopied(false), 2000)
      },
      () => setCopyError('복사에 실패했습니다 — 위 명령을 직접 복사하세요.')
    )
  }

  const checkForUpdate = (): void => {
    setUpdateError(null)
    setUpdateResult(null)
    setUpdateChecking(true)
    window.minuting
      .checkForUpdate()
      .then((r) => {
        setUpdateChecking(false)
        setUpdateResult(r)
      })
      .catch((e) => {
        setUpdateChecking(false)
        setUpdateError('업데이트 확인에 실패했습니다: ' + errMessage(e))
      })
  }

  const startUpdateDownload = (): void => {
    setUpdateError(null)
    setUpdateDownloading(true)
    window.minuting.downloadUpdate().catch((e) => {
      setUpdateDownloading(false)
      setUpdateError(installGuardMessage(e) ?? '업데이트 적용에 실패했습니다: ' + errMessage(e))
    })
  }

  const updatePercent =
    updateProgress && updateProgress.total > 0
      ? Math.min(100, Math.round((updateProgress.transferred / updateProgress.total) * 100))
      : 0

  const githubSyncEnabled = !!(github?.loggedIn && github.repo)

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <h2>설정</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="닫기">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {error && <p className="setting-error">{error}</p>}

        <div className="setting-row">
          <div className="setting-label">Claude</div>
          <div className="setting-desc">{CLAUDE_DEPENDENCY_NOTICE}</div>
          <div className="setting-path-row">
            {/* which claude가 증명하는 건 "설치"뿐이다. GitHub의 "연결됨"(토큰 검증 완료)과
                같은 어휘를 쓰면 로그인 안 된 상태를 사용 가능으로 오해하게 된다. */}
            <div className="setting-desc">
              {envError !== null ? '확인 실패' : env === null ? '확인 중…' : env.claude ? '설치됨' : '미설치'}
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                recheckClaude().catch(() => {})
              }}
              disabled={envChecking}
            >
              {envChecking ? '확인 중…' : '다시 확인'}
            </button>
          </div>
          {/* 실패를 삼키면 낡은 값이 그대로 남아 "다시 확인" 버튼이 거짓말을 한다. */}
          {envError !== null && <p className="setting-error">환경 확인 실패: {envError}</p>}

          {env !== null && !env.claude && (
            <>
              <div className="setting-desc">터미널에서 아래 명령으로 설치한 뒤 [다시 확인]을 누르세요.</div>
              <div className="setting-path-row">
                <div className="setting-path" title={CLAUDE_INSTALL_COMMAND}>
                  {CLAUDE_INSTALL_COMMAND}
                </div>
                <button type="button" className="btn-ghost" onClick={copyInstallCommand}>
                  {installCopied ? '복사됨' : '복사'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => window.minuting.openExternal(CLAUDE_DOCS_URL).catch(() => {})}
                >
                  설치 문서
                </button>
              </div>
              {copyError !== null && <p className="setting-error">{copyError}</p>}
            </>
          )}

          {env?.claude && (
            // 로그인은 대화형 CLI 절차라 앱이 대신할 수 없다. 안내 + 재검사 루프가 최선이다.
            <div className="setting-desc">
              요약이 계속 실패한다면 터미널에서 claude 를 실행해 로그인 상태와 남은 사용량을 확인하세요.
            </div>
          )}
        </div>

        <div className="setting-row">
          <div className="setting-label">테마</div>
          <div className="setting-desc">화면 밝기를 선택합니다.</div>
          <div className="segmented">
            <button
              type="button"
              className={`segmented-item${props.theme === 'light' ? ' active' : ''}`}
              onClick={() => props.onThemeChange('light')}
            >
              라이트
            </button>
            <button
              type="button"
              className={`segmented-item${props.theme === 'dark' ? ' active' : ''}`}
              onClick={() => props.onThemeChange('dark')}
            >
              다크
            </button>
          </div>
        </div>

        {settings?.repoRootIsGitRepo && (
          <div className="setting-row">
            <div className="setting-label">자동 업로드 (Git Push)</div>
            <div className="setting-desc">
              끄면 회의록이 로컬에만 저장되고, 원격 저장소에 자동으로 올리지 않습니다.
            </div>
            <button
              type="button"
              className={`switch${settings?.autoPush ? ' on' : ''}`}
              role="switch"
              aria-checked={settings?.autoPush ?? false}
              aria-label="자동 업로드"
              onClick={() => updateAutoPush(!(settings?.autoPush ?? true))}
            >
              <span className="switch-knob" />
            </button>
          </div>
        )}

        <div className="setting-row">
          <div className="setting-label">회의록 저장 위치</div>
          <div className="setting-desc">회의록 파일이 저장·커밋되는 git 저장소 경로입니다.</div>
          <div className="setting-path-row">
            <div className="setting-path" title={settings?.repoRoot}>
              {settings?.repoRoot ?? '불러오는 중…'}
            </div>
            <button type="button" className="btn-ghost" onClick={pickRepoRoot}>
              폴더 선택
            </button>
            {settings && settings.repoRoot !== settings.defaultRepoRoot && (
              <button type="button" className="btn-ghost" onClick={resetRepoRootToDefault}>
                기본 위치로 재설정
              </button>
            )}
          </div>
        </div>

        <RosterSection />

        <div className="setting-row">
          <div className="setting-label">연동 (Slack)</div>
          <div className="setting-desc">
            회의가 끝나면 요약을 지정한 채널로 자동 발송합니다. 봇 토큰은 암호화해 보관하며 렌더러 화면에는 절대
            평문으로 표시되지 않습니다.
          </div>

          {!slackTokenEditing && slackToken && !slackToken.saved && (
            <>
              <div className="setting-desc">① 워크스페이스 관리자에게 봇 토큰(xoxb-…)을 공유받습니다</div>
              <div className="setting-desc">② 아래 [봇 토큰 입력]으로 붙여넣고 저장합니다</div>
              <div className="setting-desc">③ 저장 후 나타나는 드롭다운에서 발송받을 채널을 선택합니다</div>
              <div className="setting-path-row">
                <button type="button" className="btn-ghost" onClick={() => setSlackTokenEditing(true)}>
                  봇 토큰 입력
                </button>
              </div>
            </>
          )}

          {slackTokenEditing && (
            <>
              <input
                type="password"
                placeholder="xoxb-로 시작하는 토큰"
                value={slackTokenInput}
                onChange={(e) => setSlackTokenInput(e.target.value)}
              />
              <div className="setting-path-row">
                <button type="button" className="btn-primary" onClick={saveSlackToken}>
                  저장
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setSlackTokenEditing(false)
                    setSlackTokenInput('')
                    setSlackError(null)
                  }}
                >
                  취소
                </button>
              </div>
            </>
          )}

          {!slackTokenEditing && slackToken?.saved && (
            <>
              <div className="setting-path-row">
                <div className="setting-path">봇 토큰 등록됨 ●●●●●● (암호화 보관)</div>
                <button type="button" className="btn-ghost" onClick={() => setSlackTokenEditing(true)}>
                  변경
                </button>
                <button type="button" className="btn-ghost" onClick={clearSlackToken}>
                  해제
                </button>
              </div>

              <div className="setting-desc">
                Minit 봇을 초대한 채널만 아래 목록에 나타납니다. 채널에서 [채널명 → 통합 → 앱 → Minit 추가]로
                초대하세요.
              </div>
              {slackChannels !== null && slackChannels.length === 0 ? (
                <div className="setting-desc">
                  아직 Minit 봇이 추가된 채널이 없습니다. 위 안내대로 초대 후 새로고침하세요.
                </div>
              ) : (
                <SlackChannelSelect
                  channels={slackChannels}
                  value={settings?.slackChannelId ?? ''}
                  onFocus={loadSlackChannelOptions}
                  onChange={(value) => {
                    const channel = (slackChannels ?? []).find((c) => c.id === value)
                    if (channel) selectSlackChannel(channel)
                  }}
                  leading={
                    <>
                      <option value="">채널을 선택하세요</option>
                      {slackChannels === null && settings?.slackChannelId && (
                        <option value={settings.slackChannelId}>
                          {settings.slackChannelName ? `# ${settings.slackChannelName}` : settings.slackChannelId}
                        </option>
                      )}
                    </>
                  }
                />
              )}
              <div className="setting-path-row">
                <button type="button" className="btn-ghost" onClick={loadSlackChannels} disabled={slackChannelsLoading}>
                  {slackChannelsLoading ? '불러오는 중…' : '채널 목록 새로고침'}
                </button>
                <span className="setting-desc">
                  현재 채널: {settings?.slackChannelName ? `#${settings.slackChannelName}` : '선택 안 함'}
                </span>
              </div>
            </>
          )}
          {slackError && <p className="setting-error">{slackError}</p>}
        </div>

        <div className="setting-row">
          <div className="setting-label">GitHub 계정</div>
          <div className="setting-desc">
            회의가 끝나면 선택한 저장소의 minit/ 폴더에 자동 업로드하고, 동료가 올린 회의록도 내려받아 함께
            보여줍니다.
          </div>
          {githubConnecting ? (
            <GithubConnectFlow onDone={finishGithubConnect} />
          ) : github?.loggedIn ? (
            <>
              <div className="setting-desc">연결됨: @{github.login}</div>
              <select
                value={github.repo ?? ''}
                onFocus={loadGithubRepoOptions}
                onChange={(e) => changeGithubRepo(e.target.value)}
              >
                <option value="">저장소 선택 안 함</option>
                {(githubRepos ?? (github.repo ? [github.repo] : [])).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <div className="setting-path-row">
                <button type="button" className="btn-ghost" onClick={logoutGithub}>
                  로그아웃
                </button>
              </div>
            </>
          ) : (
            <div className="setting-path-row">
              <div className="setting-desc">미연결</div>
              <button type="button" className="btn-ghost" onClick={() => setGithubConnecting(true)}>
                연결
              </button>
            </div>
          )}
          {githubError && <p className="setting-error">{githubError}</p>}
        </div>

        <div className="setting-row">
          <div className="setting-label">자동 동기화</div>
          <div className="setting-desc">
            {githubSyncEnabled
              ? '회의록을 자동으로 업로드하고, 원격 저장소의 새 회의록을 자동으로 받아옵니다.'
              : 'GitHub에 로그인하고 저장소를 선택하면 켜집니다.'}
          </div>
          <button
            type="button"
            className={`switch${githubSyncEnabled && settings?.githubSync ? ' on' : ''}`}
            role="switch"
            aria-checked={githubSyncEnabled && (settings?.githubSync ?? false)}
            aria-label="자동 동기화"
            disabled={!githubSyncEnabled}
            onClick={() => updateGithubSync(!(settings?.githubSync ?? false))}
          >
            <span className="switch-knob" />
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-label">버전</div>
          <div className="setting-desc">Minit v{version ?? '…'}</div>
          <div className="setting-path-row">
            <button
              type="button"
              className="btn-ghost"
              onClick={checkForUpdate}
              disabled={updateChecking || updateDownloading}
            >
              {updateChecking ? '확인 중…' : '업데이트 확인'}
            </button>
            {updateResult && !updateResult.available && !updateResult.error && (
              <span className="setting-desc">최신 버전입니다</span>
            )}
            {updateResult?.available && !updateDownloading && (
              <>
                <span className="setting-desc">새 버전 v{updateResult.version}</span>
                <button type="button" className="btn-primary" onClick={startUpdateDownload}>
                  업데이트
                </button>
              </>
            )}
          </div>
          {updateDownloading && !updateError && (
            <>
              <div
                className="progress-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={updatePercent}
              >
                <div className="progress-bar-fill" style={{ width: `${updatePercent}%` }} />
              </div>
              <p className="env-progress-label">다운로드 중… {updatePercent}% (완료되면 자동으로 재시작합니다)</p>
            </>
          )}
          {updateResult?.error === 'feed_unreachable' && (
            <p className="setting-desc">
              업데이트 서버에 접근할 수 없습니다. 저장소가 비공개인 동안에는 자동 업데이트가 동작하지 않으며,
              공개(public)로 전환되면 자동으로 활성화됩니다.
            </p>
          )}
          {updateError && <p className="setting-error">{updateError}</p>}
        </div>
      </div>
    </div>
  )
}
