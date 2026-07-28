<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="resources/brand/lockup-dark.svg">
    <img src="resources/brand/lockup-light.svg" alt="Minit" width="280">
  </picture>
</p>

<p align="center">대면 회의를 위한 회의록 앱 — 녹음하면 회의 내용과 요약을 자동으로 작성합니다</p>

<p align="center">
  <img alt="release" src="https://img.shields.io/github/v/release/git-artinus/minit?color=FF6B35&label=release">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-0A84FF">
  <img alt="electron" src="https://img.shields.io/badge/electron-39-47848F">
  <img alt="license" src="https://img.shields.io/badge/license-All%20Rights%20Reserved-lightgrey">
</p>

<p align="center">
  <a href="https://git-artinus.github.io/minit/"><strong>다운로드 및 사용 안내 →</strong></a>
</p>

---

## 소개

Minit(미닛)은 대면 회의를 녹음하면 회의 내용과 요약을 자동으로 작성해 회의록으로 남겨주는 macOS 앱이다. 이름은 회의록을 뜻하는 `minutes`에서 따왔다. 오디오는 기기 안에서만 처리되어 밖으로 나가지 않으며, 회의록은 로컬에 저장되고 필요하면 GitHub 저장소로 자동 백업된다.

## 주요 기능

- 녹음 → 회의 내용 → 요약까지 한 번에 처리하는 파이프라인
- 오디오가 기기 밖으로 나가지 않는 온디바이스 음성 인식
- 회의 유형에 따라 구성이 달라지는 요약과 액션아이템 자동 생성
- 회의록 공유 — 클립보드 복사·Slack 전송·파일 내보내기
- 참석자 명단 관리 및 참석자 기준 회의록 필터
- 회의록 삭제(휴지통 이동) 및 요약 재생성
- 메뉴바 트레이 상주, 다크/라이트 모드
- Slack 자동 발송 (선택, 기본은 발송 안 함)
- GitHub 저장소 자동 백업 (선택, 로그인 없이도 모든 기능 사용 가능)

## 문서

| | |
| --- | --- |
| [설치](https://git-artinus.github.io/minit/docs/install/) | 다운로드와 요구사항 |
| [첫 실행](https://git-artinus.github.io/minit/docs/first-run/) | 실행 직후 준비되는 것들 |
| [회의록 만들기](https://git-artinus.github.io/minit/docs/recording/) | 녹음부터 공유까지 |
| [GitHub 백업](https://git-artinus.github.io/minit/docs/github-backup/) | 저장소 연동 |
| [Slack 자동 발송](https://git-artinus.github.io/minit/docs/slack/) | 요약 자동 발송 설정 |
| [데이터 처리](https://git-artinus.github.io/minit/docs/privacy/) | 녹음·토큰을 어떻게 다루는지 |
| [문제 해결](https://git-artinus.github.io/minit/docs/troubleshooting/) | 자주 겪는 증상 |
| [변경 이력](https://git-artinus.github.io/minit/changelog/) | 릴리즈별 변경 내용 |

## 기여

이슈·PR을 환영한다. 개발 환경 설정·테스트·커밋 컨벤션은 [CONTRIBUTING.md](CONTRIBUTING.md)를, 에이전트·기여자 공통 정책은 [AGENTS.md](AGENTS.md)를 참고한다. 보안 취약점은 공개 이슈 대신 [SECURITY.md](SECURITY.md)의 경로로 알려주기 바란다.

## 라이선스

**All Rights Reserved** — [LICENSE](LICENSE) 참조.

---

<p align="center">
  <sub>Built with <a href="https://github.com/ggml-org/whisper.cpp">whisper.cpp</a> and <a href="https://www.electronjs.org/">Electron</a>. 오픈소스 라이선스 고지는 <a href="THIRD-PARTY-NOTICES.md">THIRD-PARTY-NOTICES.md</a> 참조.</sub>
</p>
