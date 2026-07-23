// 모든 외부 HTTP 호출(Slack/GitHub)이 공유하는 타임아웃 래퍼. AbortController로 timeoutMs
// 경과 시 요청을 취소한다 — 네트워크가 응답 없이 멈춰도 호출부가 무한 대기하지 않는다.
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  options: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
