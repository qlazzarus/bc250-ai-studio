#!/usr/bin/env bash
# Two phases, with an operator-controlled VM reboot between them.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 2 ]] || exit 1
source_dir=$1
mode=$2
[[ $mode == prepare || $mode == verify ]] || exit 1
fixture=/opt/bc250-wiki-reboot-fixture-tools
records=/var/backups/bc250-wiki-reboot-fixture
unit=bc250-wiki-reboot-fixture.service
unit_file=/etc/systemd/system/$unit
dropin=/etc/systemd/system/$unit.d
marker=/var/lib/bc250-wiki-reboot-fixture
trap 'echo "시험 중단. 시험 unit·조건과 기록을 보존합니다: $fixture $records $unit_file $dropin $marker" >&2' ERR
if [[ $mode == prepare ]]; then
  for path in "$fixture" "$records" "$unit_file" "$dropin" "$marker"; do
    [[ ! -e $path && ! -L $path ]] || exit 1
  done
  [[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
  install -d -o root -g root -m 0755 "$fixture"
  install -d -o root -g root -m 0700 "$records"
  for name in wiki-condition-fence.py wiki-maintenance-fence.py read-systemd-conditions.py \
    verify-wiki-condition.py check-service-cgroup.py; do
    install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$fixture/$name"
  done
  cat > "$unit_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
[Install]
WantedBy=multi-user.target
EOF
  cat /proc/sys/kernel/random/boot_id > "$records/boot-before"
  chmod 0600 "$records/boot-before"
  sync -f "$records/boot-before"
  sync -f "$records"
  restorecon -RF "$fixture" "$records"
  restorecon -F "$unit_file"
  systemctl daemon-reload
  systemctl enable "$unit" >/dev/null
  systemctl start "$unit"
fi
python3 - "$fixture" "$records" "$unit" "$marker" "$mode" <<'PY'
import importlib.util
import subprocess
import sys
from pathlib import Path

fixture, records, unit, marker, mode = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]), sys.argv[5]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('reboot_fixture_fence', fixture / 'wiki-condition-fence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.UNIT = unit
module.PERSISTENT_MARKER = marker
fence = module.WikiConditionFence(fixture, records, persistent=True)
if mode == 'prepare':
    if fence.acquire() is not True or fence.check() is not True:
        raise SystemExit('시험 재부팅 전 차단을 확인하지 못했습니다.')
    print('시험 unit 자동 시작 설정·영구 조건·정지 상태와 차단 기록 확인', flush=True)
    print('시험 재부팅 준비 완료. VM과 시험 파일을 그대로 유지합니다.', flush=True)
else:
    before = (records / 'boot-before').read_text().strip()
    after = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    if not before or before == after:
        raise SystemExit('시험 VM이 실제로 재부팅된 것을 확인하지 못했습니다.')
    if fence.resume_confirmed() is not True or fence.check() is not True:
        raise SystemExit('시험 재부팅 후 영구 차단을 확인하지 못했습니다.')
    print('시험 VM 재부팅 후 unit 자동 시작 차단·조건·완료 기록 확인', flush=True)
    if fence.release(can_release=lambda: True) is not True:
        raise SystemExit('시험 unit 원래 실행 상태 복원에 실패했습니다.')
    print('기록 기반 시험 차단 해제와 기존 실행 상태 복원 확인', flush=True)
    subprocess.run(['/usr/bin/systemctl', 'stop', unit], check=True, timeout=120)
    subprocess.run(['/usr/bin/systemctl', 'disable', unit], check=True, timeout=120,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
PY
if [[ $mode == verify ]]; then
  rm -- "$unit_file"
  systemctl daemon-reload
  echo "시험 unit 정리 완료; 시험 기록 보관: $fixture $records"
fi
