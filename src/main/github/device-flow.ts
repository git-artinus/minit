import { fetchWithTimeout } from '../../shared/fetch-timeout'

// GitHub OAuth Device Flow. client_id는 공개값(OAuth App, Device Flow 활성화)이라 코드에 커밋해도 된다.
export const GITHUB_CLIENT_ID = 'Ov23livXNVHjYsNaO41p'
const DEVICE_CODE_SCOPE = 'repo'

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
  expires_in: number
}

function headers(): Record<string, string> {
  return { Accept: 'application/json', 'Content-Type': 'application/json' }
}

// POST github.com/login/device/code — user_code·verification_uri를 받아온다(사용자에게 표시할 값).
export async function requestDeviceCode(
  fetchImpl: typeof fetch,
  clientId: string = GITHUB_CLIENT_ID,
  timeoutMs = 10_000
): Promise<DeviceCodeResponse> {
  const res = await fetchWithTimeout(
    fetchImpl,
    'https://github.com/login/device/code',
    { method: 'POST', headers: headers(), body: JSON.stringify({ client_id: clientId, scope: DEVICE_CODE_SCOPE }) },
    timeoutMs
  )
  if (!res.ok) throw new Error(`GitHub device code 요청 실패: ${res.status}`)
  const data = (await res.json()) as DeviceCodeResponse & { error?: string }
  if (data.error) throw new Error(`GitHub device code 오류: ${data.error}`)
  return data
}

export type PollResult =
  | { status: 'success'; accessToken: string }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export interface PollForTokenOptions {
  // 실제 대기(setTimeout)를 주입해 폴링 로직을 결정적으로 테스트한다.
  sleep: (ms: number) => Promise<void>
  clientId?: string
  // 무한 루프 방지용 상한(기본은 없음 — expired_token 응답으로 자연 종료됨을 전제).
  maxAttempts?: number
  // 개별 요청 타임아웃(기본 10초). 전체 폴링 만료는 기존 expires(maxAttempts/expired_token) 로직이 담당한다.
  timeoutMs?: number
  // 로그인 세션 무효화(새 로그인 시작·명시적 취소) 시 폴링을 즉시 종료하기 위한 훅 — 매 반복 확인한다.
  isCancelled?: () => boolean
}

// POST github.com/login/oauth/access_token 폴링. GitHub Device Flow 스펙대로
// authorization_pending(대기 계속)·slow_down(interval+5s)·expired_token/access_denied(중단)를 처리한다.
export async function pollForToken(
  deviceCode: string,
  intervalSec: number,
  fetchImpl: typeof fetch,
  opts: PollForTokenOptions
): Promise<PollResult> {
  let interval = intervalSec
  const maxAttempts = opts.maxAttempts ?? Infinity
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.isCancelled?.()) return { status: 'cancelled' }
    await opts.sleep(interval * 1000)
    if (opts.isCancelled?.()) return { status: 'cancelled' }

    const res = await fetchWithTimeout(
      fetchImpl,
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          client_id: opts.clientId ?? GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      },
      opts.timeoutMs ?? 10_000
    )
    const data = (await res.json()) as { access_token?: string; error?: string }

    if (data.access_token) return { status: 'success', accessToken: data.access_token }

    switch (data.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        interval += 5
        continue
      case 'expired_token':
        return { status: 'expired' }
      case 'access_denied':
        return { status: 'denied' }
      default:
        return { status: 'error', message: data.error ?? `HTTP ${res.status}` }
    }
  }
  return { status: 'expired' }
}
