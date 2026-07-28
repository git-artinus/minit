import type { UpdateCheckResult } from '../../../shared/types'

/** 버전을 모르는 결과도 dismiss 대상이 되도록 키를 정규화한다(undefined면 비교가 늘 어긋난다). */
export function updateVersionKey(result: UpdateCheckResult): string {
  return result.version ?? '(unknown)'
}

/**
 * 배너를 보여줄지. [나중에]는 **그 버전에만** 적용한다.
 *
 * 예전에는 boolean 래치였는데, 한 번 미루면 이후 주기 확인이 새 버전을 감지해 IPC로 보내도
 * 배너가 영영 뜨지 않았다 — main은 알림을 배달했다고 믿고 렌더러가 흔적 없이 버리는 상태였다.
 * 주기 확인을 추가한 의미 자체가 사라지므로 버전 단위로 바꿨다.
 */
export function shouldShowUpdateBanner(
  available: UpdateCheckResult | null,
  dismissedKey: string | null
): boolean {
  if (available === null || !available.available) return false
  return updateVersionKey(available) !== dismissedKey
}
