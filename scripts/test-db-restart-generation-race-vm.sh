#!/usr/bin/env bash
# Detect one injected generation change in disposable services, not a full fence.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /var/backups/bc250-db-restart-race.XXXXXXXX)
suffix=${fixture##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
studio=bc250-race-studio-$suffix.service
gate=bc250-race-gate-$suffix.service
trap 'echo "시험 중단. 시험 unit과 기록 보존: $studio $gate $fixture" >&2' ERR
for unit in "$studio" "$gate"; do
  file=/run/systemd/system/$unit
  [[ ! -e $file && ! -L $file && ! -e /etc/systemd/system/$unit \
    && $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
  cat > "$file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
Restart=on-failure
RestartSec=1
KillMode=control-group
EOF
  chmod 0644 "$file"
  restorecon -F "$file"
done
restorecon -RF "$fixture"
systemctl daemon-reload
systemctl start "$studio" "$gate"
python3 - "$source_dir/deploy/model-control/old-studio-process-watch.py" "$studio" "$gate" "$fixture" <<'PY'
import importlib.util
import subprocess
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fixture_watch', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
studio, gate, fixture = sys.argv[2], sys.argv[3], Path(sys.argv[4])
def pid(unit):
    value = subprocess.check_output(['/usr/bin/systemctl', 'show', unit, '-p', 'MainPID', '--value'], text=True).strip()
    if not value.isdecimal() or int(value) <= 1:
        raise RuntimeError('시험 주 프로세스를 확인하지 못했습니다.')
    return int(value)
old_studio, old_gate = pid(studio), pid(gate)
watch_studio = module.OldStudioProcessWatch(old_studio, module.process_starttime(old_studio))
watch_gate = module.OldStudioProcessWatch(old_gate, module.process_starttime(old_gate))
try:
    subprocess.run(['/usr/bin/systemctl', 'kill', '--kill-whom=main', '--signal=KILL', studio], check=True)
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        try:
            current = pid(studio)
        except RuntimeError:
            current = 0
        if watch_studio.exited() and current and current != old_studio:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('시험 서비스 재시작을 확인하지 못했습니다.')
    if watch_gate.exited() or pid(gate) != old_gate:
        raise RuntimeError('다른 시험 서비스의 세대가 바뀌었습니다.')
    # This models the precondition at the start of fence setup, not a fence.
    if not watch_studio.exited() and pid(studio) == old_studio:
        (fixture / 'approved').touch()
        raise RuntimeError('재시작된 시험 서비스를 기존 세대로 허용했습니다.')
    if (fixture / 'approved').exists():
        raise RuntimeError('세대 확인 전에 승인 표시가 생성됐습니다.')
    print('시험 서비스 재시작으로 기존 pidfd 종료와 새로운 주 프로세스 확인', flush=True)
    print('시험 차단 준비 전 세대 변경을 감지해 승인 표시 생성 전 중단 확인', flush=True)
finally:
    watch_studio.close()
    watch_gate.close()
PY
systemctl stop "$studio" "$gate"
rm -- "/run/systemd/system/$studio" "/run/systemd/system/$gate"
systemctl daemon-reload
trap - ERR
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture"
echo '단일 시험 경합만 관찰했습니다. 실제 차단·DB 접근·다른 프로세스와 운영 서비스는 시험하지 않았습니다.'
