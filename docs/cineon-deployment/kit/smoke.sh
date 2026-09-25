#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-https://cineon.me}"
BASE="${BASE%/}"
check() {
  local route="$1" expected="$2" actual
  actual=$(curl --connect-timeout 10 --max-time 30 -sS -o /dev/null -w '%{http_code}' "$BASE$route")
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL %s expected=%s actual=%s\n' "$route" "$expected" "$actual" >&2
    return 1
  fi
  printf 'PASS %s status=%s\n' "$route" "$actual"
}
check / 200
check /health 200
check /api/auth/providers 200
check /api/auth/session 200
check /api/auth/csrf 200
check /api/auth/me 401
check /api/local-playback-diagnostic 404
printf 'SMOKE PASS (HTTP routing only; not a playback or dependency readiness test)\n'
