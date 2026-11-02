#!/usr/bin/env bash
# Exercise legacy gate pause restoration with a disposable VM-only gate.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/migrate-legacy-gate.py ]] || exit 1
unit=bc250-legacy-rollback-fixture.service
unit_path=/run/systemd/system/$unit
[[ ! -e $unit_path && ! -e /etc/systemd/system/$unit ]] || exit 1
[[ -z $(ss -H -ltn 'sport = :18881') ]] || { echo '시험 포트가 사용 중입니다.' >&2; exit 1; }
fixture=$(mktemp -d /var/tmp/bc250-legacy-rollback.XXXXXXXX)
trap 'echo "시험 중단. 시험 서비스와 기록을 보존합니다: $fixture" >&2' ERR
cat > "$unit_path" <<'EOF'
[Service]
User=ai-gate
Group=ai-gate
Environment=GATE_API_KEY=vm-only-legacy-key-0123456789abcdef
ExecStart=/opt/bc250-model-control/.venv/bin/python -I -m uvicorn app.gate:create_gate_app --factory --host 127.0.0.1 --port 18881 --workers 1 --no-access-log
KillMode=control-group
EOF
systemctl daemon-reload
systemctl start "$unit"
python3 - "$1/deploy/model-control/migrate-legacy-gate.py" "$fixture" "$unit" <<'PY'
import importlib.util
import subprocess
import sys
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('migration', sys.argv[1])
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
migration.URL = 'http://127.0.0.1:18881/control'
key = 'vm-only-legacy-key-0123456789abcdef'
fixture = Path(sys.argv[2])
unit = sys.argv[3]

def wait_ready():
    for _ in range(36):
        try:
            return migration.request(key, 'GET')
        except OSError:
            time.sleep(5)
    raise SystemExit('시험 gate 준비 시간 초과')

for original in (False, True):
    wait_ready()
    state = migration.request(key, 'PUT', {'paused': original})
    assert state['paused'] is original and state['active_requests'] == 0
    snapshot = fixture / ('paused.json' if original else 'open.json')
    migration.capture(key, snapshot)
    subprocess.run(['systemctl', 'restart', unit], check=True, timeout=60)
    assert wait_ready()['paused'] is False
    result = migration.restore_pause(key, snapshot)
    assert result['paused'] is original
    assert migration.read_snapshot(snapshot)['paused_before_maintenance'] is original
    print('재시작 후 기존 관리자 보류 복원 확인:', '설정' if original else '없음', flush=True)
PY
systemctl stop "$unit"
rm -- "$unit_path"
systemctl daemon-reload
echo "시험 gate 정리 완료. 시험 기록 보관: $fixture"
