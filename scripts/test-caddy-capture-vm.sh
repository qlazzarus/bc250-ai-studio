#!/usr/bin/env bash
# Verify capture on disposable files, without touching Caddy or services.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 1 && -f $1/deploy/model-control/capture-caddy.py \
  && -f $1/deploy/model-control/create-maintenance-caddy.py ]] || exit 1
fixture=$(mktemp -d /var/backups/bc250-caddy-capture-test.XXXXXXXX)
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture" >&2' ERR
install -m 0644 "$1/deploy/model-control/capture-caddy.py" "$fixture/capture-caddy.py"
install -m 0644 "$1/deploy/model-control/create-maintenance-caddy.py" "$fixture/create-maintenance-caddy.py"
restorecon -RF "$fixture"
python3 - "$fixture" <<'PY'
import importlib.util
import os
import pwd
import stat
import struct
import sys
from pathlib import Path

fixture = Path(sys.argv[1])
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

generator = fixture / 'create-maintenance-caddy.py'
rules = load('fixture_generator', generator)
capture = load('fixture_capture', fixture / 'capture-caddy.py')
source = fixture / 'Caddyfile'
source.write_text('\n'.join(rules.EXPECTED) + '\n', encoding='utf-8')
source.chmod(0o644)
entries = ((1, 6, 0xffffffff), (2, 4, pwd.getpwnam('ai-studio').pw_uid),
           (4, 4, 0xffffffff), (16, 4, 0xffffffff), (32, 4, 0xffffffff))
acl = struct.pack('<I', 2) + b''.join(struct.pack('<HHI', *entry) for entry in entries)
os.setxattr(source, 'system.posix_acl_access', acl)
snapshot = capture.capture(source, fixture, generator)
saved = snapshot / 'Caddyfile.original'
candidate = snapshot / 'Caddyfile.maintenance'
assert stat.S_IMODE(snapshot.stat().st_mode) == 0o700
assert stat.S_IMODE(saved.stat().st_mode) == 0o644
assert capture.metadata(saved) == capture.metadata(source)
assert saved.read_bytes() == source.read_bytes()
assert os.getxattr(saved, 'system.posix_acl_access') == acl
assert candidate.read_text().count('respond "Service temporarily unavailable" 503') == 2
assert stat.S_IMODE(candidate.stat().st_mode) == 0o600
before = set(fixture.glob('bc250-caddy-snapshot.*'))
source.write_text(':80 {\n import /tmp/unknown\n}\n', encoding='utf-8')
try:
    capture.capture(source, fixture, generator)
except ValueError:
    pass
else:
    raise SystemExit('예상과 다른 Caddy 설정이 잘못 허용됐습니다.')
assert set(fixture.glob('bc250-caddy-snapshot.*')) == before
assert saved.read_bytes() != source.read_bytes()
print('시험 Caddy 원본·권한·ACL·확장 속성과 503 후보 보관 확인')
print('예상과 다른 Caddy 설정은 보관 전 거절 확인')
PY
echo "시험 파일 보관: $fixture"
