#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="$HOME/.minit/signing/notary.env"
[ -f "$ENV_FILE" ] || { echo "서명 자격 없음: $ENV_FILE"; exit 1; }
set -a; source "$ENV_FILE"; set +a
# zip은 electron-updater 자동 업데이트에 필수(Squirrel.Mac이 zip만 지원) — dmg는 최초 설치용.
npm run build && npx electron-builder --mac dmg zip --publish never

echo "── dist/ 산출물 확인 ──"
ls -la dist/*.dmg dist/*.zip dist/latest-mac.yml 2>/dev/null \
  || echo "경고: dmg/zip/latest-mac.yml 중 일부가 dist/에 없습니다"
