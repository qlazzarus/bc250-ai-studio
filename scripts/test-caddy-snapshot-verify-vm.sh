#!/usr/bin/env bash
# Verify a copy of the previous fixture; do not alter the original evidence.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 1 && -f $1/deploy/model-control/capture-caddy.py \
  && -f $1/deploy/model-control/create-maintenance-caddy.py ]] || exit 1
previous=/var/backups/bc250-caddy-capture-test.fHj3rMUO/bc250-caddy-snapshot.2xg49t9e
[[ -f $previous/Caddyfile.original && -f $previous/Caddyfile.maintenance \
  && -f $previous/CAPTURE-SHA256SUMS ]] || {
  echo '이전 가짜 Caddy 보관 자료가 없습니다.' >&2; exit 1;
}
fixture=$(mktemp -d /var/backups/bc250-caddy-verify-test.XXXXXXXX)
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture" >&2' ERR
install -m 0644 "$1/deploy/model-control/capture-caddy.py" "$fixture/capture-caddy.py"
install -m 0644 "$1/deploy/model-control/create-maintenance-caddy.py" "$fixture/create-maintenance-caddy.py"
restorecon -F "$fixture/capture-caddy.py" "$fixture/create-maintenance-caddy.py"
cp -a "$previous" "$fixture/snapshot"
cp -a "$previous/Caddyfile.original" "$fixture/current"
python3 - "$fixture" <<'PY'
import importlib.util
import sys
from pathlib import Path

fixture = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('capture', fixture / 'capture-caddy.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)
snapshot = fixture / 'snapshot'
source = fixture / 'current'
generator = fixture / 'create-maintenance-caddy.py'
capture.verify_snapshot(snapshot, source, generator)
print('시험 Caddy 보관 내용과 현재 원본 일치 확인')
candidate = snapshot / 'Caddyfile.maintenance'
original = candidate.read_bytes()
candidate.write_bytes(b'tampered\n')
try:
    capture.verify_snapshot(snapshot, source, generator)
except ValueError:
    print('시험 유지보수 후보 변조 거절 확인')
else:
    raise SystemExit('변조된 후보가 잘못 허용됐습니다.')
candidate.write_bytes(original)
source.write_bytes(b'changed\n')
try:
    capture.verify_snapshot(snapshot, source, generator)
except ValueError:
    print('시험 현재 Caddy 원본 변경 거절 확인')
else:
    raise SystemExit('변경된 원본이 잘못 허용됐습니다.')
PY
echo "시험 파일 보관: $fixture"
