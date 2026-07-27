import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clampMenuPosition, type Point } from './context-menu-position'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
}

// 회의록 카드 우클릭 메뉴. 네이티브 Menu.popup 대신 렌더러에서 그려 앱 테마(라이트/다크)를
// 그대로 따르게 한다. 대신 네이티브가 공짜로 주던 것들 — 바깥 클릭·ESC·스크롤 시 닫기, 화면
// 경계 보정 — 을 여기서 직접 처리한다.
export function MeetingContextMenu({
  at,
  items,
  onClose
}: {
  at: Point
  items: ContextMenuItem[]
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // 실제 렌더 크기를 재기 전에는 클릭 지점을 그대로 쓰고, 측정 후 화면 안으로 당긴다.
  const [pos, setPos] = useState<Point>(at)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos(clampMenuPosition(at, { width, height }, { width: window.innerWidth, height: window.innerHeight }))
  }, [at])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // capture 단계로 받아 카드의 onClick(선택)보다 먼저 메뉴를 닫는다.
    const onPointerDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`context-menu-item${item.danger ? ' danger' : ''}`}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
