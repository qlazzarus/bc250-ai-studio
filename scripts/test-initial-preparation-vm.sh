#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
release=$(mktemp -d /opt/bc250-preparation-source.XXXXXXXX)
fixture=$(mktemp -d /var/lib/bc250-preparation-fixture.XXXXXXXX)
chmod 0755 "$release"
trap 'echo "시험 중단. 시험 파일을 보존합니다: $release $fixture" >&2' ERR
for name in prepare-initial-settings.py prepare-state.py prepare-secrets.py verify-staged-secrets.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$release/$name"
done
restorecon -RF "$release" "$fixture"
python3 - "$release" "$fixture" <<'PY'
import importlib.util
import stat
import sys
from pathlib import Path

release, fixture = map(Path, sys.argv[1:])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('initial_preparation', release / 'prepare-initial-settings.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def paths(prefix):
    root = fixture / prefix
    root.mkdir(mode=0o700)
    module.STATE, module.CONFIG, module.GATE, module.CODE = (root / x for x in ('state', 'config', 'gate', 'code'))
paths('success')
module.GATE.mkdir(mode=0o700)
try:
    module.prepare(release, check_release=lambda: True)
except ValueError as error:
    if '기존 상태' not in str(error):
        raise
else:
    raise SystemExit('기존 시험 gate 상태가 허용됐습니다.')
if module.STATE.exists() or module.CONFIG.exists():
    raise SystemExit('기존 시험 대상 거절 전에 파일이 생성됐습니다.')
module.GATE.rmdir()
if module.prepare(release, check_release=lambda: True) is not True:
    raise SystemExit('시험 준비에 실패했습니다.')
if ((module.STATE / 'switch.json').read_bytes() != b'{}\n' or
        stat.S_IMODE(module.STATE.stat().st_mode) != 0o750 or
        stat.S_IMODE((module.STATE / 'switch.json').stat().st_mode) != 0o640 or
        (module.STATE / 'legacy-pause.json').exists()):
    raise SystemExit('시험 전환 기록 상태가 올바르지 않습니다.')
try:
    module.prepare(release, check_release=lambda: True)
except ValueError as error:
    if '기존 상태' not in str(error):
        raise
else:
    raise SystemExit('기존 시험 설정의 재생성이 허용됐습니다.')
print('시험 빈 journal·별도 키 설정 준비 및 재사용 거절 확인', flush=True)
paths('failure')
original = module.load
def load_with_failure(name, path):
    result = original(name, path)
    if name == 'prepare_secrets':
        def fail():
            raise RuntimeError('injected fixture failure')
        result.main = fail
    return result
module.load = load_with_failure
try:
    module.prepare(release, check_release=lambda: True)
except RuntimeError as error:
    if str(error) != 'injected fixture failure':
        raise
else:
    raise SystemExit('시험 설정 실패를 감지하지 못했습니다.')
finally:
    module.load = original
if not (module.STATE / 'switch.json').is_file() or module.CONFIG.exists():
    raise SystemExit('시험 부분 상태가 보존되지 않았습니다.')
try:
    module.prepare(release, check_release=lambda: True)
except ValueError as error:
    if '기존 상태' not in str(error):
        raise
else:
    raise SystemExit('부분 생성된 시험 상태의 재사용이 허용됐습니다.')
print('시험 설정 생성 실패 시 상태 보존 및 재시도 거절 확인', flush=True)
print('시험 경로만 사용했으며 서비스나 모델을 변경하지 않았습니다.', flush=True)
PY
echo "시험 파일 보관: $release $fixture"
