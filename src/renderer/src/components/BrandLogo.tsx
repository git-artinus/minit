// Minit 브랜드 로고 — Concept 1 "Soundlines" 글리프의 인라인 SVG React 컴포넌트.
// currentColor·var(--color-primary)만 사용해 라이트/다크 테마에 자동 대응한다(테마 전환은
// [data-theme] 속성으로 CSS 변수를 바꾸는 방식 — theme.css 참조).
// 원본 디자인: resources/brand/mark.svg, resources/brand/lockup-light.svg (Concept 1 "Soundlines")

// 웨이브(소리)+줄글(회의록) 글리프 — badge.svg의 배경 없이 스트로크만 사용한다.
function MarkGlyph(): React.JSX.Element {
  return (
    <g strokeWidth={6} strokeLinecap="round" fill="none">
      <g stroke="var(--color-primary)">
        <path d="M16 17 V25" />
        <path d="M24 11 V31" />
        <path d="M32 15 V27" />
        <path d="M40 12 V28" />
        <path d="M48 18 V24" />
      </g>
      <g stroke="currentColor">
        <path d="M16 38 H48" />
        <path d="M16 49 H36" />
      </g>
    </g>
  )
}

export function BrandMark({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <MarkGlyph />
    </svg>
  )
}

export function BrandLockup({ height = 20 }: { height?: number }): React.JSX.Element {
  const width = (height * 252) / 72
  return (
    <svg viewBox="0 0 252 72" width={width} height={height} role="img" aria-label="Minit">
      <g transform="translate(0,8) scale(0.875)">
        <MarkGlyph />
      </g>
      <g transform="translate(76,0)">
        <g stroke="currentColor" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* m */}
          <path d="M12 58 V22" />
          <path d="M12 32 Q12 22 22 22 Q32 22 32 32 V58" />
          <path d="M32 32 Q32 22 42 22 Q52 22 52 32 V58" />
          {/* i */}
          <path d="M70 58 V22" />
          {/* n */}
          <path d="M88 58 V22" />
          <path d="M88 32 Q88 22 98 22 Q108 22 108 32 V58" />
          {/* i */}
          <path d="M126 58 V22" />
          {/* t */}
          <path d="M146 12 V47 Q146 58 157 58" />
          <path d="M137 22 H158" />
        </g>
        {/* i 도트 = REC 닷 */}
        <circle cx={70} cy={6} r={5.5} fill="var(--color-primary)" />
        <circle cx={126} cy={6} r={5.5} fill="var(--color-primary)" />
      </g>
    </svg>
  )
}
