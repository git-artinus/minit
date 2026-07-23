# Contributing

Minit 개발에 기여하는 방법을 정리한다.

## 개발 환경

```bash
git clone https://github.com/git-artinus/minit.git
cd minit
npm install
npm run dev
```

`npm run dev`는 electron-vite 개발 서버를 띄운다.

## 테스트·타입체크

```bash
npm test        # vitest
npm run typecheck   # tsc (main/renderer 각각)
```

PR을 올리기 전에 두 명령 모두 통과해야 한다.

## 프로젝트 구조

```
minit/
├── src/
│   ├── main/       # Electron 메인 프로세스 — 녹음·파이프라인·git·GitHub·Slack·tray
│   ├── preload/    # main ↔ renderer IPC 브릿지
│   ├── renderer/   # React UI (audio, components, state)
│   └── shared/     # 공용 타입·회의록 파싱/직렬화
├── resources/
│   ├── bin/        # whisper-cli 번들 바이너리
│   └── brand/      # 로고·트레이 아이콘 SVG, 브랜드 PNG
└── tests/          # vitest 테스트
```

회의록 파일은 실행 시 앱이 자체 생성하는 사용자 저장 위치(기본 `~/.minit`)에 저장되며, 저장소에는 포함되지 않는다.

## 커밋 컨벤션

한국어 [Conventional Commits](https://www.conventionalcommits.org/ko/)를 따른다.

```
feat(github): 레포 검색 필터 추가

fix(slack): 웹훅 타임아웃 시 재시도하지 않던 문제 수정
```

## 브랜치·PR 흐름

- `main`에 직접 커밋하지 않는다. 작업 브랜치를 만들어 PR로 올린다.
- 머지는 merge commit을 사용한다(squash 금지).

## 릴리즈 빌드

서명·공증된 배포 빌드(`npm run release:mac`)는 메인테이너 전용이다. 코드 서명 자격이 있어야 실행할 수 있다.
