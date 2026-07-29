---
title: 설치
description: Minit을 macOS에 설치하는 방법과 요구사항
sidebar:
  order: 1
---

## 설치하기

1. [최신 버전 다운로드 →](https://github.com/git-artinus/minit/releases/latest)에서 `minit-<버전>.dmg`를 받습니다.
2. 받은 DMG를 열어 **`Minit.app`을 Applications 폴더로 드래그**합니다.
3. Applications에서 Minit을 실행합니다.

:::tip[릴리즈 페이지에 파일이 여러 개인 이유]
`.zip`·`.blockmap`·`latest-mac.yml`은 앱이 스스로 업데이트할 때 쓰는 파일입니다.
직접 받으실 것은 **`.dmg` 하나**입니다. [사이트 첫 화면의 다운로드 버튼](/minit/)을 쓰면
항상 그 파일로 바로 연결됩니다.
:::

설치 후에는 새 버전이 나오면 앱이 알려주고 클릭 한 번으로 업데이트됩니다. 알림에서
**릴리즈 노트**를 누르면 그 버전에서 무엇이 바뀌었는지 바로 확인할 수 있습니다.

## 요구사항

| 항목 | 내용 |
| --- | --- |
| OS | macOS, **Apple Silicon(M1 이상)** |
| 마이크 권한 | 최초 녹음 시 macOS가 권한을 요청합니다 |
| Claude Code CLI | (선택) 요약·액션아이템 생성용 — 없으면 회의 내용만 저장됩니다. 사용 가능 여부는 설정 → **Claude**에서 확인할 수 있습니다 |
| git | (선택) 회의록 저장 위치를 로컬 git 저장소로 지정한 경우 커밋용 |

:::caution[Intel Mac은 지원하지 않습니다]
Apple Silicon 전용입니다. Intel Mac에서는 실행되지 않습니다.
`  > 이 Mac에 관하여`에서 칩이 M1 이상인지 확인하세요.
:::

## 다음 단계

설치했다면 [첫 실행](../first-run/)으로 넘어가세요. 실행 직후 준비되는 것들과 저장 위치를 안내합니다.
