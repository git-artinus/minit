import type { GithubLoginStatusEvent } from '../../shared/types'
import type { PollResult } from './device-flow'

export interface DeviceCodeInfo {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
}

export interface LoginSessionDeps {
  requestDeviceCode: () => Promise<DeviceCodeInfo>
  // isCancelled는 실제 pollForToken(device-flow.ts)의 동일 옵션에 그대로 전달할 훅이다 — 세션이
  // 무효화되면 폴링 루프 자체가 즉시 종료되어 불필요한 네트워크 호출을 만들지 않는다.
  pollForToken: (deviceCode: string, intervalSec: number, isCancelled: () => boolean) => Promise<PollResult>
  saveToken: (accessToken: string) => void
  fetchViewer: (accessToken: string) => Promise<{ login: string }>
  sendEvent: (event: GithubLoginStatusEvent) => void
}

export interface LoginSessionManager {
  startLogin: (deps: LoginSessionDeps) => Promise<{ userCode: string; verificationUri: string }>
  // 현재 세션을 무효화한다 — 새 startLogin 호출과 명시적 취소(github:cancelLogin) 모두 이 경로를 탄다.
  cancel: () => void
}

// GitHub Device Flow 로그인 세션의 경합·취소를 관리한다(리뷰 Fix 3). 새 startLogin 호출이나
// 명시적 cancel() 모두 "세션 무효화"로 취급하며, 무효화된 세션의 폴링 결과는 토큰 저장·이벤트
// 발신 어느 쪽도 하지 않는다. ipc.ts는 이 모듈에 실제 fetch/safeStorage/BrowserWindow를 주입해
// 얇게 배선하고, 이 모듈 자체는 electron에 의존하지 않아 순수 로직으로 단위 테스트한다.
export function createLoginSessionManager(): LoginSessionManager {
  let currentSession = 0

  const cancel = (): void => {
    currentSession++
  }

  const startLogin = async (deps: LoginSessionDeps): Promise<{ userCode: string; verificationUri: string }> => {
    const sessionId = ++currentSession
    const device = await deps.requestDeviceCode()

    // 폴링은 백그라운드에서 진행하고, 완료 시점에 sendEvent로 통지한다. sessionId가 currentSession과
    // 어긋나면(그 사이 새 startLogin·cancel 호출) 어떤 부수효과도 남기지 않고 조용히 종료한다.
    void (async (): Promise<void> => {
      try {
        const result = await deps.pollForToken(device.device_code, device.interval, () => sessionId !== currentSession)
        if (sessionId !== currentSession) return

        let event: GithubLoginStatusEvent
        if (result.status === 'success') {
          deps.saveToken(result.accessToken)
          const viewer = await deps.fetchViewer(result.accessToken)
          if (sessionId !== currentSession) return
          event = { status: 'success', login: viewer.login }
        } else if (result.status === 'expired') {
          event = { status: 'expired' }
        } else if (result.status === 'denied') {
          event = { status: 'denied' }
        } else if (result.status === 'cancelled') {
          return // 방어적 — 여기 도달하는 시점엔 이미 위 sessionId 체크에서 걸러진다.
        } else {
          event = { status: 'error', message: result.message }
        }
        deps.sendEvent(event)
      } catch (e) {
        if (sessionId !== currentSession) return
        const message = e instanceof Error ? e.message : String(e)
        deps.sendEvent({ status: 'error', message })
      }
    })()

    return { userCode: device.user_code, verificationUri: device.verification_uri }
  }

  return { startLogin, cancel }
}
