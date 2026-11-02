#!/usr/bin/env bash
# Read the live Caddyfile and run only a separate loopback fixture process.
set -Eeuo pipefail
umask 077
[[ $# == 1 && -f $1/deploy/model-control/create-maintenance-caddy.py \
  && -f $1/scripts/test-maintenance-caddy.py ]] || exit 1
[[ -r /etc/caddy/Caddyfile ]] || {
  echo '현재 계정에서 Caddyfile을 읽을 수 없습니다. 권한을 변경하지 말고 중단하세요.' >&2; exit 1;
}
command -v caddy >/dev/null || { echo 'caddy 실행 파일이 없습니다.' >&2; exit 1; }
fixture=$(mktemp -d "${TMPDIR:-/tmp}/bc250-caddy-check.XXXXXXXX")
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture" >&2' ERR
python3 "$1/deploy/model-control/create-maintenance-caddy.py" \
  /etc/caddy/Caddyfile "$fixture/Caddyfile.maintenance"
caddy validate --config "$fixture/Caddyfile.maintenance" --adapter caddyfile >/dev/null
echo '유지보수 후보 Caddy 문법 확인'
python3 "$1/scripts/test-maintenance-caddy.py" "$fixture/Caddyfile.maintenance"
echo "시험 파일 보관: $fixture"
