// 우클릭 지점에 메뉴를 그대로 띄우면 창 가장자리에서 잘린다. 메뉴 크기를 실측한 뒤 화면 안으로
// 당겨 넣는 계산만 분리했다(DOM 없이 검증할 수 있도록).
export const MENU_MARGIN = 8

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

function clampAxis(start: number, size: number, limit: number): number {
  return Math.max(MENU_MARGIN, Math.min(start, limit - size - MENU_MARGIN))
}

export function clampMenuPosition(point: Point, menu: Size, viewport: Size): Point {
  return {
    x: clampAxis(point.x, menu.width, viewport.width),
    y: clampAxis(point.y, menu.height, viewport.height)
  }
}
