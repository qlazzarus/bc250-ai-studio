#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing \
  && ( $# == 1 || ( $# == 2 && $2 == persistent ) ) ]] || exit 1
source_dir=$1
mode=${2:-runtime}
fixture=$(mktemp -d /opt/bc250-wiki-condition-fence.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-wiki-condition-fence.XXXXXXXX)
chmod 0755 "$fixture"
unit=bc250-wiki-condition-fence-fixture.service
unit_file=/etc/systemd/system/$unit
runtime=/run/systemd/system/$unit.d
marker=/run/bc250-wiki-condition-fence-fixture
if [[ $mode == persistent ]]; then
  runtime=/etc/systemd/system/$unit.d
  marker=/var/lib/bc250-wiki-condition-fence-fixture
fi
for path in "$unit_file" "$runtime" "$marker"; do [[ ! -e $path && ! -L $path ]] || exit 1; done
[[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $fixture $records $unit_file $runtime $marker" >&2' ERR
for name in wiki-condition-fence.py wiki-maintenance-fence.py read-systemd-conditions.py \
  verify-wiki-condition.py check-service-cgroup.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$fixture/$name"
done
cat > "$unit_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
restorecon -RF "$fixture" "$records"
restorecon -F "$unit_file"
systemctl daemon-reload
systemctl start "$unit"
python3 - "$fixture" "$records" "$unit" "$marker" "$mode" <<'PY'
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

fixture, records, unit, marker = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4])
mode = sys.argv[5]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fixture_wiki_fence', fixture / 'wiki-condition-fence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.UNIT = unit
module.MARKER_DIR = marker
module.PERSISTENT_MARKER = marker
def ctl(*args, check=True):
    return subprocess.run(['/usr/bin/systemctl', *args], check=check, timeout=120,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def run(label, was_active):
    directory = records / label
    directory.mkdir(mode=0o700)
    fence = module.WikiConditionFence(fixture, directory, persistent=mode == 'persistent')
    if fence.acquire() is not True or fence.check() is not True:
        raise SystemExit('시험 조건 차단이 확인되지 않았습니다.')
    if mode == 'persistent' and label == 'active':
        ctl('daemon-reexec')
        if fence.check() is not True:
            raise SystemExit('시험 systemd 재실행 뒤 차단이 유지되지 않았습니다.')
        print('시험 systemd 재실행 뒤 영구 조건과 정지 상태 유지 확인', flush=True)
    ctl('start', unit, check=False)
    if fence.check() is not True:
        raise SystemExit('시험 시작 요청 이후 차단 상태가 바뀌었습니다.')
    try:
        fence.release(can_release=lambda: False)
    except ValueError:
        pass
    else:
        raise SystemExit('해제 조건이 없는 시험 해제가 허용됐습니다.')
    if fence.check() is not True:
        raise SystemExit('시험 차단이 의도치 않게 해제됐습니다.')
    if fence.release(can_release=lambda: True) is not True:
        raise SystemExit('시험 원래 상태 복원에 실패했습니다.')
    rows = [json.loads(line) for line in (directory / 'wiki-fence.jsonl').read_text().splitlines()]
    if ([row['event'] for row in rows] != ['condition:begin', 'condition:confirmed', 'release:begin', 'release:confirmed']
            or rows[0]['was_active'] is not was_active
            or rows[0]['persistent'] is not (mode == 'persistent')):
        raise SystemExit('시험 차단 기록이 올바르지 않습니다.')
run('active', True)
print('시험 Wiki 조건 설치·systemd 시작 차단·기존 실행 상태 복원 확인', flush=True)
ctl('stop', unit)
run('inactive', False)
print('기존 정지 상태 보존과 해제 조건 없을 때 차단 유지 확인', flush=True)
print('다른 직접 호출과 VM 재부팅 후 차단은 이 시험 범위 밖입니다.', flush=True)
PY
systemctl stop "$unit"
rm -- "$unit_file"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture $records"
