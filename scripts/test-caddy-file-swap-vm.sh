#!/usr/bin/env bash
# Test only atomic file swaps and injected failure in disposable VM paths.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 1 && -f $1/deploy/model-control/caddy-file-swap.py ]] || exit 1
previous=/var/backups/bc250-caddy-capture-test.fHj3rMUO/bc250-caddy-snapshot.2xg49t9e
[[ -f $previous/Caddyfile.original && -f $previous/CAPTURE-SHA256SUMS ]] || exit 1
fixture=$(mktemp -d /var/backups/bc250-caddy-swap-test.XXXXXXXX)
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture" >&2' ERR
for name in capture-caddy.py create-maintenance-caddy.py caddy-file-swap.py; do
  install -m 0644 "$1/deploy/model-control/$name" "$fixture/$name"
  restorecon -F "$fixture/$name"
done
cp -a "$previous" "$fixture/snapshot"
cp -a "$previous/Caddyfile.original" "$fixture/Caddyfile"
python3 - "$fixture" <<'PY'
import importlib.util
import os
import sys
from pathlib import Path

fixture = Path(sys.argv[1])
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

capture = load('capture', fixture / 'capture-caddy.py')
swap = load('swap', fixture / 'caddy-file-swap.py')
snapshot = fixture / 'snapshot'
live = fixture / 'Caddyfile'
generator = fixture / 'create-maintenance-caddy.py'
original = live.read_bytes()
metadata = capture.metadata(live)
swap.swap(snapshot, live, generator, 'enter', capture)
assert live.read_bytes() == (snapshot / 'Caddyfile.maintenance').read_bytes()
assert capture.metadata(live) == metadata
swap.swap(snapshot, live, generator, 'restore', capture)
assert live.read_bytes() == original and capture.metadata(live) == metadata
print('시험 Caddyfile 교체·복원과 보호 속성 유지 확인')

replace = os.replace
def fail_replace(*args):
    raise OSError('fixture-injected-rename-failure')
os.replace = fail_replace
try:
    try:
        swap.swap(snapshot, live, generator, 'enter', capture)
    except OSError as exc:
        if str(exc) != 'fixture-injected-rename-failure':
            raise
    else:
        raise SystemExit('주입한 교체 실패가 발생하지 않았습니다.')
finally:
    os.replace = replace
assert live.read_bytes() == original and capture.metadata(live) == metadata
assert list(fixture.glob('.bc250-caddy.*'))
print('시험 파일 교체 실패 시 원본과 임시 증거 보존 확인')
PY
echo "시험 파일 보관: $fixture"
