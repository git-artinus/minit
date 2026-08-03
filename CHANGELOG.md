# Changelog

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르며,
버전 체계는 [Semantic Versioning](https://semver.org/lang/ko/)을 따른다.

각 릴리즈의 사용자 관점 안내와 설치 파일은 [GitHub Releases](https://github.com/git-artinus/minit/releases)에 있다.

## [0.13.1] - 2026-08-03

### Changed

- **업데이트 알림의 링크가 Minit 변경 이력 화면으로 연결된다** — 새 버전 알림에서 누르면
  GitHub 대신 [변경 이력](https://git-artinus.github.io/minit/changelog/)의 해당 버전으로 바로
  이동한다. 버튼 이름도 `릴리즈 노트`에서 `변경 이력`으로 바뀌었다.
  - 자동 업데이트 확인이 반복 실패했을 때 뜨는 `릴리즈 페이지에서 직접 받기`는 그대로
    GitHub 릴리즈로 연결된다. 설치 파일을 바로 받는 것이 목적이라 사이트 상태와 무관해야 한다.
- **변경 이력 화면을 다시 정리했다** — 버전·배포일·내려받기 링크를 왼쪽에 모으고 내용을
  오른쪽에 뒀다. 버전 사이에 구분선이 생겼고, 오른쪽 목차에서 원하는 버전으로 바로 갈 수 있다.
  문서 페이지와 본문 폭·검색창 위치가 어긋나던 것도 맞췄다.

## [0.13.0] - 2026-08-03

### Added

- **Slack 발송 범위 선택** — 설정에서 Slack 메시지에 담을 내용을 `요약만` / `+ 액션아이템` / `전체 섹션`
  중에 고른다. 기본값은 `+ 액션아이템`. 회의 종료 후 자동 발송, 요약 재생성 후 발송, 회의록 공유
  버튼의 수동 발송 세 경로에 모두 적용된다.
  - 필터 기준은 회의 타입이 아니라 섹션 종류(`actions`)다. 회의 타입이 늘어도 설정은 그대로 동작한다.
  - 아이디어·간이 회의는 액션아이템 섹션이 없어 `+ 액션아이템`과 `요약만`의 결과가 같다.
- **회의 타입별 분량 기준** — 회의 타입마다 요약 분량과 섹션별 항목 수 기준선을 갖는다.

### Changed

- **요약이 문단으로 나뉜다** — 요약을 한 덩어리가 아니라 1~2문단으로 생성하고, 회의록 화면과 Slack
  메시지에서 문단 구분을 유지한다.
- **회의록 항목이 짧고 간결해졌다** — 항목 하나를 한 문장으로 쓰고, 같은 주제는 병합하며, 요약에
  이미 담긴 내용은 반복하지 않는다. 실측 기준 항목 최대 길이가 300자에서 47자로 줄었다.
- **위클리 분량이 안정됐다** — 같은 길이의 주간 회의에서 항목 수가 실행마다 2.24배까지 벌어지던 것이
  1.45배로 좁혀졌다. 주간 회의록 한 건이 4,171자에서 약 1,400자가 됐다.
- **위클리의 `상태` 섹션이 `진행 상황`으로 바뀌었다** — 결정도 할 일도 아닌 내용이 모두 모이던 섹션의
  범위를 작업 단위의 현재 위치로 좁혔다. 이미 저장된 회의록은 `상태` 표기 그대로 유지된다.

### Fixed

- 요약을 문단으로 나눠 저장해도 회의록을 다시 열면 한 문단으로 붙던 문제
- 불릿 사이에 빈 줄이 있는 회의록을 손으로 편집했을 때 목록이 일반 문단으로 잘못 인식되던 문제

## 이전 릴리즈

CHANGELOG는 0.13.0부터 관리한다. 이전 버전의 변경 내용은 각 릴리즈 노트를 참고한다.

| 버전 | 날짜 |
|---|---|
| [0.12.1](https://github.com/git-artinus/minit/releases/tag/v0.12.1) | 2026-07-29 |
| [0.12.0](https://github.com/git-artinus/minit/releases/tag/v0.12.0) | 2026-07-29 |
| [0.11.0](https://github.com/git-artinus/minit/releases/tag/v0.11.0) | 2026-07-29 |
| [0.10.0](https://github.com/git-artinus/minit/releases/tag/v0.10.0) | 2026-07-28 |
| [0.9.0](https://github.com/git-artinus/minit/releases/tag/v0.9.0) | 2026-07-27 |
| [0.8.1](https://github.com/git-artinus/minit/releases/tag/v0.8.1) | 2026-07-27 |
| [0.8.0](https://github.com/git-artinus/minit/releases/tag/v0.8.0) | 2026-07-27 |
| [0.7.0](https://github.com/git-artinus/minit/releases/tag/v0.7.0) | 2026-07-26 |
| [0.6.0](https://github.com/git-artinus/minit/releases/tag/v0.6.0) | 2026-07-24 |
| [0.5.1](https://github.com/git-artinus/minit/releases/tag/v0.5.1) | 2026-07-24 |
| [0.5.0](https://github.com/git-artinus/minit/releases/tag/v0.5.0) | 2026-07-24 |
| [0.4.4](https://github.com/git-artinus/minit/releases/tag/v0.4.4) | 2026-07-23 |

[0.13.1]: https://github.com/git-artinus/minit/releases/tag/v0.13.1
[0.13.0]: https://github.com/git-artinus/minit/releases/tag/v0.13.0
