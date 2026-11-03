#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-systemd-condition-read.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-systemd-condition-read.XXXXXXXX)
chmod 0755 "$fixture"
unit=bc250-condition-read-fixture.service
unit_file=/etc/systemd/system/$unit
dropin_dir=/run/systemd/system/$unit.d
marker=$records/blocked
for path in "$unit_file" "$dropin_dir"; do [[ ! -e $path && ! -L $path ]] || exit 1; done
[[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $fixture $records $unit_file $dropin_dir" >&2' ERR
for name in read-systemd-conditions.py verify-wiki-condition.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$fixture/$name"
done
cat > "$unit_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
mkdir -m 0755 "$dropin_dir"
touch "$marker"
cat > "$dropin_dir/90-bc250-test.conf" <<EOF
[Unit]
ConditionPathExists=!$marker
EOF
chmod 0644 "$dropin_dir/90-bc250-test.conf"
restorecon -F "$unit_file"
restorecon -RF "$fixture" "$records" "$dropin_dir"
systemctl daemon-reload
python3 - "$fixture" "$records" "$unit" <<'PY'
import importlib.util
import json
import sys
from pathlib import Path

fixture, records, unit = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
sys.dont_write_bytecode = True
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, fixture / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
reader = load('fixture_systemd_conditions', 'read-systemd-conditions.py')
verifier = load('fixture_verify_condition', 'verify-wiki-condition.py')
result = reader.read_conditions(unit)
marker = str(records / 'blocked')
if verifier.require_block_condition(result, marker) is not True:
    raise SystemExit('시험 부정 경로 조건을 확인하지 못했습니다.')
with (records / 'condition.json').open('w') as file:
    json.dump(result, file)
try:
    verifier.require_block_condition(result, marker + '-different')
except ValueError:
    pass
else:
    raise SystemExit('다른 시험 marker가 허용됐습니다.')
print('정지된 시험 unit을 같은 D-Bus 연결에서 참조해 조건 조회 확인', flush=True)
print('정확한 부정 경로 조건 확인과 다른 marker 거절 확인', flush=True)
print('시험 unit은 시작하지 않았습니다.', flush=True)
PY
rm -- "$dropin_dir/90-bc250-test.conf" "$unit_file"
rmdir -- "$dropin_dir"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture $records"
