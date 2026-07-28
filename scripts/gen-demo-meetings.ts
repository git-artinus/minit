// 랜딩페이지 스크린샷용 더미 회의록 생성기.
//
// 공개 사이트에 실제 회의록을 쓸 수 없다 — 사이드바 목록·참석자·본문이 전부 노출된다.
// 마크다운을 손으로 쓰지 않고 앱의 serializeMeeting을 재사용해 포맷 드리프트를 막는다.
// 앱이 파싱하지 못하는 더미 데이터는 쓸모가 없다.
//
//   node scripts/gen-demo-meetings.ts <대상디렉터리>
//
// 대상디렉터리 아래 meetings/ 를 만들고 그 안에 회의록을 쓴다.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { meetingFilename, serializeMeeting } from '../src/shared/meeting-file.ts'
import type { Meeting } from '../src/shared/types.ts'

type Demo = Omit<Meeting, 'filename'>

const at = (d: string): string => `${d}+09:00`

const demos: Demo[] = [
  {
    title: '제품 주간 회의',
    date: at('2026-07-27T10:00:00'),
    durationMin: 42,
    meetingType: 'general',
    participants: ['김도현', '박서연', '이준호', '최민아'],
    summary:
      '랜딩페이지 착수를 확정했다. 설치 파일을 어디서 받는지 묻는 문의가 반복돼 다운로드 ' +
      '진입점을 하나로 정리하기로 했다. 문서는 사이트로 옮기고 README는 진입점만 남긴다. ' +
      '스크린샷은 이번 주 안에 준비한다.',
    sections: [
      {
        heading: '논의',
        kind: 'list',
        items: [
          '릴리즈 파일이 여러 개라 어떤 걸 받아야 하는지 매번 물어본다',
          '설치 안내가 한곳에만 있어 찾아 들어가기 번거롭다',
          '변경 내역을 따로 관리하면 릴리즈 노트와 어긋난다'
        ]
      },
      {
        heading: '액션아이템',
        kind: 'actions',
        items: [
          { text: '랜딩페이지 초안 작성', assignee: '김도현', due: '2026-07-30' },
          { text: '설치 문서 이관', assignee: '박서연' },
          { text: '앱 화면 캡처 준비', assignee: '이준호', due: '2026-07-29' }
        ]
      }
    ],
    segments: [
      { startMs: 0, text: '오늘은 랜딩페이지 건부터 보겠습니다.' },
      { startMs: 7000, text: '설치 파일을 어디서 받는지 묻는 문의가 이번 주만 네 건이었어요.' },
      { startMs: 19000, text: '릴리즈 페이지에 파일이 여러 개라 헷갈리는 것 같습니다.' },
      { startMs: 31000, text: '다운로드 버튼 하나로 정리하면 그 문의는 사라질 겁니다.' },
      { startMs: 48000, text: '문서도 같이 옮기죠. 지금은 한 파일에 다 들어 있어서 길어요.' },
      { startMs: 63000, text: '스크린샷이 없으면 설명이 잘 안 와닿을 것 같은데요.' },
      { startMs: 75000, text: '이번 주 안에 준비하겠습니다.' }
    ]
  },
  {
    title: '신규 입사자 온보딩',
    date: at('2026-07-24T14:00:00'),
    durationMin: 28,
    meetingType: 'general',
    participants: ['박서연', '정하늘'],
    summary:
      '온보딩 첫 주 일정과 개발 환경 준비 항목을 공유했다. 계정 발급은 금요일까지 완료하기로 했다.',
    sections: [
      {
        heading: '액션아이템',
        kind: 'actions',
        items: [
          { text: '사내 계정 발급 요청', assignee: '박서연', due: '2026-07-25' },
          { text: '개발 환경 설치 가이드 전달', assignee: '박서연' }
        ]
      }
    ],
    segments: [
      { startMs: 0, text: '첫 주는 환경 세팅과 코드 구조 파악 위주로 갑니다.' },
      { startMs: 14000, text: '계정은 이번 주 금요일까지 나올 예정입니다.' },
      { startMs: 26000, text: '궁금한 건 언제든 물어보세요.' }
    ]
  },
  {
    title: '스프린트 회고',
    date: at('2026-07-22T16:30:00'),
    durationMin: 55,
    meetingType: 'general',
    participants: ['김도현', '이준호', '최민아', '정하늘'],
    summary:
      '릴리즈 주기가 짧아진 점은 유지하고, 배포 전 검증 절차를 문서로 고정하기로 했다.',
    sections: [
      {
        heading: '잘된 점',
        kind: 'list',
        items: ['릴리즈 주기가 짧아져 피드백 반영이 빨라졌다', '릴리즈 노트 서식이 정착됐다']
      },
      { heading: '개선할 점', kind: 'list', items: ['배포 전 검증 절차가 사람마다 다르다'] }
    ],
    segments: [
      { startMs: 0, text: '이번 스프린트 회고 시작하겠습니다.' },
      { startMs: 11000, text: '릴리즈가 빨라진 건 확실히 체감됩니다.' }
    ]
  },
  {
    title: '디자인 리뷰',
    date: at('2026-07-21T11:00:00'),
    durationMin: 34,
    meetingType: 'general',
    participants: ['최민아', '김도현'],
    summary: '설정 화면 정보 구조를 단순화하기로 했다. 연동 항목을 하나의 묶음으로 모은다.',
    sections: [
      {
        heading: '액션아이템',
        kind: 'actions',
        items: [{ text: '설정 화면 구조 시안 정리', assignee: '최민아', due: '2026-07-24' }]
      }
    ],
    segments: [
      { startMs: 0, text: '설정 화면이 길어져서 항목을 찾기 어렵다는 의견이 있었어요.' },
      { startMs: 16000, text: '연동 관련된 걸 한 묶음으로 모으면 나을 것 같습니다.' }
    ]
  }
]

const target = process.argv[2]
if (!target) {
  console.error('사용법: node scripts/gen-demo-meetings.ts <대상디렉터리>')
  process.exit(1)
}

const dir = path.join(target.replace(/^~/, process.env.HOME ?? '~'), 'meetings')
await mkdir(dir, { recursive: true })

for (const m of demos) {
  const filename = meetingFilename(m.title, new Date(m.date))
  await writeFile(path.join(dir, filename), serializeMeeting(m), 'utf8')
  console.log(`생성: ${filename}`)
}
console.log(`\n${demos.length}건 → ${dir}`)
