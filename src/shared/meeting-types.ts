// 회의 타입 레지스트리(v0.6.0 #3) — 내장 타입의 단일 진실원.
// 타입별 출력 구조(sectionDefs)와 요약 방향(promptGuidance)을 여기에만 정의한다.
// 직렬화·렌더러·Slack은 타입이 아니라 섹션 kind로만 분기하므로, 타입 추가는 이 파일 수정으로 끝난다.
export type SectionKind = 'text' | 'list' | 'actions'
export interface SectionDef {
  heading: string
  kind: SectionKind
  // 상한이 아니라 기준선이다. 프롬프트에 "안팎"으로 전달하고 코드로 자르지 않는다 —
  // 개수를 맞추려다 핵심이 빠지는 것이 장황한 것보다 나쁘다.
  typicalItems: number
}
export interface MeetingTypeDef {
  id: string
  label: string
  sectionDefs: SectionDef[]
  promptGuidance: string
  // 타입별 요약 분량. 54분 위클리와 5분 간이 회의에 같은 분량을 요구하면 둘 중 하나가 망가진다.
  summaryGuide: string
}

export const DEFAULT_MEETING_TYPE = 'general'

export const MEETING_TYPES: MeetingTypeDef[] = [
  {
    id: 'general', label: '일반',
    sectionDefs: [{ heading: '액션아이템', kind: 'actions', typicalItems: 5 }],
    summaryGuide: '1~2문단',
    promptGuidance: '회의의 핵심 논의·결정 사항을 요약하고, 후속 조치를 액션아이템으로 정리한다.'
  },
  {
    id: 'daily', label: '데일리',
    sectionDefs: [
      { heading: '진척', kind: 'list', typicalItems: 4 },
      { heading: '블로커', kind: 'list', typicalItems: 3 },
      { heading: '오늘 할 일', kind: 'actions', typicalItems: 5 }
    ],
    summaryGuide: '1문단',
    promptGuidance: '데일리 스탠드업이다. 최근 진척, 막힌 점(블로커), 오늘 할 일 중심으로 정리한다.'
  },
  {
    id: 'weekly', label: '위클리',
    sectionDefs: [
      { heading: '결정사항', kind: 'list', typicalItems: 4 },
      { heading: '진행 상황', kind: 'list', typicalItems: 4 },
      { heading: '다음 주 액션아이템', kind: 'actions', typicalItems: 5 }
    ],
    summaryGuide: '1~2문단(문단당 3~4문장)',
    // '상태'는 결정도 액션도 아닌 것의 수집기가 돼 실측에서 한 회의에 23개까지 나왔다.
    // 이름과 지시를 함께 좁힌다 — 이름 자체가 LLM에 주는 힌트다.
    promptGuidance:
      '주간 회의다. 내려진 결정, 작업별 진행 상황, 다음 주 할 일 중심으로 정리한다. 진행 상황에는 작업·과제 단위의 현재 위치만 적는다. 회의에서 오간 논의·의견·아직 결정되지 않은 것은 넣지 마라. 같은 작업에 대한 여러 언급은 하나로 합쳐라.'
  },
  {
    id: 'idea', label: '아이디어',
    sectionDefs: [
      { heading: '아이디어', kind: 'list', typicalItems: 7 },
      { heading: '후보 방향', kind: 'list', typicalItems: 3 }
    ],
    summaryGuide: '1~2문단',
    promptGuidance:
      '브레인스토밍/아이데이션 회의다. 발산된 아이디어를 폭넓게 담고, 좁혀진 후보 방향이 있으면 정리한다. 액션아이템을 억지로 만들지 마라.'
  },
  {
    id: 'deepdive', label: '고도화·딥다이브',
    sectionDefs: [
      { heading: '기술 결정', kind: 'list', typicalItems: 4 },
      { heading: '트레이드오프', kind: 'list', typicalItems: 4 },
      { heading: '후속 과제', kind: 'actions', typicalItems: 5 }
    ],
    summaryGuide: '1~2문단',
    promptGuidance: '기술 심화(고도화) 회의다. 내려진 기술 결정, 검토된 트레이드오프, 후속 과제 중심으로 정리한다.'
  },
  {
    id: 'quick', label: '간이·싱크',
    sectionDefs: [],
    summaryGuide: '2~3문장',
    promptGuidance: '짧은 간이 회의다. 핵심 결정만 간결히 요약한다.'
  }
]

// 미지의 id(구버전 파일·오타)는 general로 폴백한다.
export function meetingTypeDef(id: string | undefined): MeetingTypeDef {
  return MEETING_TYPES.find((t) => t.id === id) ?? MEETING_TYPES[0]
}
