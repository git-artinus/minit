import { describe, expect, test } from 'vitest'
import { clampMenuPosition, MENU_MARGIN } from '../../src/renderer/src/components/context-menu-position'

const menu = { width: 160, height: 80 }
const viewport = { width: 1000, height: 600 }

describe('clampMenuPosition', () => {
  test('여백이 충분하면 클릭 좌표를 그대로 쓴다', () => {
    expect(clampMenuPosition({ x: 100, y: 200 }, menu, viewport)).toEqual({ x: 100, y: 200 })
  })

  test('오른쪽 경계를 넘치면 메뉴가 화면 안에 들어오도록 왼쪽으로 당긴다', () => {
    expect(clampMenuPosition({ x: 950, y: 200 }, menu, viewport)).toEqual({
      x: viewport.width - menu.width - MENU_MARGIN,
      y: 200
    })
  })

  test('아래 경계를 넘치면 위로 당긴다', () => {
    expect(clampMenuPosition({ x: 100, y: 580 }, menu, viewport)).toEqual({
      x: 100,
      y: viewport.height - menu.height - MENU_MARGIN
    })
  })

  test('메뉴가 뷰포트보다 커도 좌표가 음수로 나가지 않는다', () => {
    expect(clampMenuPosition({ x: 10, y: 10 }, { width: 1200, height: 900 }, viewport)).toEqual({
      x: MENU_MARGIN,
      y: MENU_MARGIN
    })
  })
})
