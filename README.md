<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="resources/brand/lockup-dark.svg">
    <img src="resources/brand/lockup-light.svg" alt="Minit" width="280">
  </picture>
</p>

<p align="center">로컬에서 동작하는 온디바이스 회의록 앱 - 녹음을 자동으로 전사하고 요약합니다</p>

<p align="center">
  <img alt="release" src="https://img.shields.io/badge/release-v0.7.0-FF6B35">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-0A84FF">
  <img alt="electron" src="https://img.shields.io/badge/electron-39-47848F">
  <img alt="license" src="https://img.shields.io/badge/license-All%20Rights%20Reserved-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/git-artinus/minit/releases/latest"><strong>최신 버전 다운로드 →</strong></a>
</p>

---

## 소개

Minit(미닛)은 대면 회의를 녹음하면 전사·요약까지 자동으로 처리해 회의록으로 남겨주는 macOS 앱이다. 이름은 회의록을 뜻하는 `minutes`에서 따와, "미닛"이라는 발음을 살려 짧게 지은 것이다. 오디오는 기기 안에서만 처리되어 밖으로 나가지 않으며, 회의록은 로컬에 저장되고 필요하면 GitHub 저장소로 자동 백업된다.

## ✨ 주요 기능

- 녹음 → 전사 → 요약까지 한 번에 처리하는 파이프라인
- 오디오가 기기 밖으로 나가지 않는 온디바이스 음성 인식
- 회의록 요약·액션아이템 자동 생성
- 참석자 명단 관리 및 참석자 기준 회의록 필터
- 다크/라이트 모드 지원
- 메뉴바 트레이 상주 및 트레이에서 바로 회의 시작/종료
- 녹음 중 비정상 종료 시 복구 가능한 녹음 목록 제공
- 요약 결과 재생성
- Slack 자동 발송 (선택, 기본은 발송 안 함)
- GitHub 로그인 후 회의록 저장소 자동 백업 (선택, 로그인 없이도 모든 기능 사용 가능)

## 📦 설치

1. [최신 버전 다운로드 →](https://github.com/git-artinus/minit/releases/latest)에서 DMG를 받는다.
2. DMG를 열어 `Minit.app`을 Applications 폴더로 드래그한다.
3. Applications에서 Minit을 실행한다.

설치 후에는 새 버전이 나오면 앱이 알려주고 클릭 한 번으로 업데이트됩니다.
(저장소가 비공개인 동안에는 대기 상태이며, 공개 전환 시 자동 활성화됩니다)

### 요구사항

| 항목 | 내용 |
| --- | --- |
| OS | macOS, Apple Silicon (M1 이상) |
| 마이크 권한 | 최초 녹음 시 macOS가 권한을 요청 |
| Claude Code CLI | (선택) 요약·액션아이템 생성용 — 없으면 전사만 저장됨 |
| git | (선택) 회의록 저장 위치를 로컬 git 저장소로 지정한 경우 커밋용 |

## 🚀 첫 실행

앱은 실행 즉시 바로 사용할 수 있다.

- 우측 하단에 설치 패널이 뜨고, 음성 인식 모델(약 1.6GB)을 1회 다운로드한다. 다운로드가 끝나기 전까지는 "회의 시작"만 비활성화되며, 나머지 화면은 그대로 사용할 수 있다.
- GitHub 로그인 팝업이 함께 뜬다. 선택 사항이며 "로그인 없이 사용하기"를 눌러 건너뛸 수 있다.
- 회의록은 기본적으로 `~/.minit`에 저장된다. 설정(톱니 아이콘)에서 저장 경로를 git 저장소로 바꿀 수 있다.
- 녹음 원본 오디오는 회의록 저장이 끝난 뒤에도 **로컬에 최대 7일 보존**된 뒤 자동 삭제된다. 인식 오류가 의심되는 회의를 재확인·복구하기 위한 것이며, 오디오는 기기 밖으로 나가지 않는다.

## 🐙 GitHub 백업 설정하기

**로그인 없이도 모든 기능을 그대로 사용할 수 있다.** 회의록은 항상 먼저 로컬(설정한 저장 위치)에 저장되며, GitHub 연결은 그 위에 얹는 선택적 백업이다.

1. 첫 실행 시 뜨는 로그인 팝업에서 **GitHub 연결**을 누르거나, Minit 설정(톱니 아이콘) → **GitHub 계정** 섹션에서 **연결**을 누른다.
2. 화면에 표시된 코드를 복사하고 브라우저에서 GitHub 인증 페이지를 열어 입력·승인한다.
3. 로그인 후 저장소 목록에서 회의록을 백업할 저장소를 선택한다.

이후 회의록이 저장될 때마다 선택한 저장소의 `minit/` 폴더로 자동 업로드된다. 업로드가 실패해도 회의록은 로컬에 그대로 남고, 다음 회의 저장이나 앱 포커스 시 자동으로 재시도한다. 다른 팀원이 올린 회의록도 자동으로 내려받아 함께 보여준다. 저장소는 설정에서 언제든 바꾸거나 로그아웃할 수 있다. 레포를 처음 선택하면 **자동 동기화** 스위치가 자동으로 켜지며, 이후 설정 → **GitHub 계정** 섹션에서 언제든 끄고 켤 수 있다.

## 💬 Slack 자동 발송 설정하기

회의가 끝나면 요약을 Slack 채널로 자동 발송할 수 있다. **기본값은 발송 안 함**이다. 워크스페이스당 앱·봇 토큰은 1개면 되고, 발송 채널 선택은 팀원별로 각자 한다.

**(A) 최초 1회 — 워크스페이스 관리자**

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch** → 앱 이름(예: Minit)과 워크스페이스 선택 (승인제 워크스페이스면 설치 시 관리자 승인이 필요할 수 있다)
2. **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**에 아래 3개를 추가한다.

   | Scope | 용도 |
   | --- | --- |
   | `chat:write` | 지정한 채널에 회의 요약 메시지를 발송한다 |
   | `channels:read` | 봇이 참여한 공개 채널 목록을 조회해 Minit 설정 화면 드롭다운에 표시한다 |
   | `groups:read` | 봇이 참여한 비공개 채널 목록을 조회한다 |

   이 3개 스코프로는 채널의 기존 대화 내용을 읽을 수 없다 — 봇이 참여한 채널 목록 조회와 메시지 발송만 가능하다. 봇은 어떤 채널에도 자동으로 참여하지 않으며, 팀원이 채널에서 직접 초대해야만 그 채널이 목록에 나타난다.
3. **Install to Workspace**(이미 설치했다면 **Reinstall to Workspace**) → 승인
4. **OAuth & Permissions** 상단의 **Bot User OAuth Token**(`xoxb-`로 시작)을 복사해 팀원에게 공유한다.

> 토큰은 시크릿이다. 공개 채널이 아닌 비밀 채널이나 패스워드 매니저로 공유한다. Minit은 이 토큰을 받는 즉시 OS 키체인 기반으로 암호화해 저장하며, 평문으로는 어디에도 남기지 않는다.

**(B) 각 팀원**

1. Minit 설정 → **연동 (Slack)** 섹션에서 **봇 토큰 입력**을 누르고 관리자에게 공유받은 토큰(`xoxb-...`)을 붙여넣어 저장한다.
2. 회의 요약을 받을 채널에서 **채널명 → 통합 → 앱 → Minit 추가**로 봇을 초대한다. **초대한 채널만** 설정 화면 드롭다운에 나타난다.
3. 설정 화면으로 돌아와 드롭다운(필요하면 **새로고침**)에서 채널을 선택한다. 비공개 채널은 🔒로 표시된다.
4. 이후 본인이 종료한 회의의 요약이 선택한 채널로 자동 발송된다. 다른 채널로 바꾸려면 그 채널에도 먼저 봇을 초대한 뒤 드롭다운에서 다시 선택하면 된다.

발송이 실패해도(예: 채널에 봇 미초대) 회의록 저장 자체에는 영향이 없다.

## 🤝 기여

이슈·PR을 환영한다. 개발 환경 설정, 테스트, 커밋 컨벤션 등 자세한 내용은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고한다.

## 📄 라이선스

**All Rights Reserved** — [LICENSE](LICENSE) 참조.

---

<p align="center">
  <sub>Built with <a href="https://github.com/ggml-org/whisper.cpp">whisper.cpp</a> and <a href="https://www.electronjs.org/">Electron</a>. 오픈소스 라이선스 고지는 <a href="THIRD-PARTY-NOTICES.md">THIRD-PARTY-NOTICES.md</a> 참조.</sub>
</p>
