#!/usr/bin/env bash
# Exercise the backup guard against disposable systemd units only.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/backup-archive.sh ]] || exit 1
source "$1/deploy/model-control/backup-archive.sh"
python3 - "$1/deploy/model-control/check-service-cgroup.py" <<'PY'
import importlib.util
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('check_cgroup', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
unit = 'bc250-cgroup-fixture.service'
properties = 'Slice=system.slice\nControlGroup=\n'
with tempfile.TemporaryDirectory(prefix='bc250-cgroup-fixture-') as temp:
    root = Path(temp)
    (root / 'cgroup.controllers').touch()
    group = root / 'system.slice' / unit
    (group / 'child').mkdir(parents=True)
    (group / 'cgroup.procs').write_text('')
    procs = group / 'child/cgroup.procs'
    procs.write_text('')
    module.check(unit, properties, root)
    procs.write_text('1234\n')
    try:
        module.check(unit, properties, root)
    except ValueError:
        pass
    else:
        raise SystemExit('시험 하위 cgroup의 프로세스를 잘못 허용했습니다.')
print('모의 하위 cgroup의 잔류 프로세스 거절 확인', flush=True)
PY
units=(bc250-backup-fixture-one.service bc250-backup-fixture-two.service bc250-backup-fixture-three.service)
for unit in "${units[@]}"; do
  [[ ! -e /run/systemd/system/$unit && ! -e /etc/systemd/system/$unit ]] || {
    echo "시험 unit이 이미 있습니다: $unit" >&2; exit 1;
  }
done
trap 'echo "시험 실패. 시험 unit 상태를 보존합니다." >&2' ERR
for unit in "${units[@]}"; do
  cat > "/run/systemd/system/$unit" <<'EOF'
[Service]
Type=simple
ExecStart=/usr/bin/sleep 600
KillMode=control-group
EOF
done
systemctl daemon-reload
systemctl start "${units[1]}"
if bc250_require_stopped "${units[@]}"; then
  echo '실행 중인 서비스를 잘못 허용했습니다.' >&2; exit 1
fi
echo '시험 서비스 실행 중에는 백업 정지 조건 거절 확인'
systemctl stop "${units[1]}"
bc250_require_stopped "${units[@]}"
echo '모든 시험 서비스 정지 후 백업 정지 조건 확인'
sed -i 's/KillMode=control-group/KillMode=process/' "/run/systemd/system/${units[2]}"
systemctl daemon-reload
if bc250_require_stopped "${units[@]}"; then
  echo 'KillMode가 다른 서비스를 잘못 허용했습니다.' >&2; exit 1
fi
echo 'KillMode가 다른 경우 거절 확인'
rm -- "${units[@]/#/\/run\/systemd\/system\/}"
systemctl daemon-reload
echo '시험 전용 unit 정리 완료'
