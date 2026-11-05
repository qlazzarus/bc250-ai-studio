#!/usr/bin/env bash
# Observe two explicitly known disposable processes, not an exhaustive scan.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 \
  && -f $1/deploy/model-control/observe-db-process-references.py ]] || exit 1
for tool in systemd-run python3 mount umount mountpoint; do command -v "$tool" >/dev/null || exit 1; done
records=$(mktemp -d /var/backups/bc250-db-known.XXXXXXXX)
data=$(mktemp -d /var/lib/bc250-db-known.XXXXXXXX)
control=$(mktemp -d /var/lib/bc250-db-known-control.XXXXXXXX)
code=$(mktemp -d /opt/bc250-db-known.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
holder="bc250-db-holder-$suffix.service"
other="bc250-db-other-$suffix.service"
for unit in "$holder" "$other"; do [[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1; done
failure() {
  systemctl stop "$holder" "$other" >/dev/null 2>&1 || true
  if mountpoint -q "$data"; then umount "$data" || echo "시험 마운트를 해제하지 못했습니다: $data" >&2; fi
  echo "시험 중단. 시험 자료 보관: $records $data $control $code" >&2
}
trap failure ERR
chmod 0755 "$code"
chown ai-studio:ai-studio "$data" "$control"
chmod 0700 "$data" "$control"
install -d -o ai-studio -g ai-studio -m 0700 "$data/database"
python3 - "$data/database/studio.sqlite3" <<'PY'
import sqlite3
import sys
connection = sqlite3.connect(sys.argv[1])
connection.execute('CREATE TABLE fixture (value TEXT)')
connection.commit()
connection.close()
PY
chown ai-studio:ai-studio "$data/database/studio.sqlite3"
chmod 0600 "$data/database/studio.sqlite3"
cat > "$code/worker.py" <<'PY'
import os
import sys
import time
from pathlib import Path

data, control, role = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
fd = os.open(data / 'database', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC) if role == 'holder' else None
(control / (role + '-ready')).write_text('ready\n')
deadline = time.monotonic() + 120
while not (control / 'stop').exists():
    if role == 'holder' and fd is not None and (control / 'close').exists():
        os.close(fd)
        fd = None
        (control / 'closed').write_text('closed\n')
    if time.monotonic() >= deadline: raise SystemExit('시험 대기 시간 초과')
    time.sleep(.1)
if fd is not None:
    os.close(fd)
PY
chmod 0644 "$code/worker.py"
restorecon -RF "$data" "$control" "$code" "$records"
for pair in "$holder:holder" "$other:other"; do
  unit=${pair%:*}
  role=${pair##*:}
  systemd-run --quiet --unit="$unit" --property=Type=exec --property=User=ai-studio \
    --property=Group=ai-studio --property=KillMode=control-group \
    /usr/bin/python3 -u "$code/worker.py" "$data" "$control" "$role"
done
ready=no
for _ in {1..90}; do
  if [[ -f $control/holder-ready && -f $control/other-ready ]]; then ready=yes; break; fi
  systemctl is-active --quiet "$holder" && systemctl is-active --quiet "$other" || {
    echo '시험 프로세스가 종료됐습니다.' >&2; false;
  }
  sleep .5
done
[[ $ready == yes ]] || { echo '시험 프로세스 준비 시간 초과' >&2; false; }
pid1=$(systemctl show "$holder" -p MainPID --value)
pid2=$(systemctl show "$other" -p MainPID --value)
[[ $pid1 =~ ^[0-9]+$ && $pid1 -gt 1 && $pid2 =~ ^[0-9]+$ && $pid2 -gt 1 && $pid1 != "$pid2" ]] || exit 1
mount --bind "$data" "$data"
mount -o remount,bind,ro "$data"
python3 - "$1/deploy/model-control/observe-db-process-references.py" "$pid1" "$pid2" "$data" "$control" "$other" <<'PY'
import importlib.util
import subprocess
import sys
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('db_references', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
holder, other = int(sys.argv[2]), int(sys.argv[3])
data, control = Path(sys.argv[4]), Path(sys.argv[5])
database, unit = data / 'database/studio.sqlite3', sys.argv[6]
result = module.observe_known_processes([holder, other], data, database)
assert 'fd' in result[holder] and not result[other], result
print('시험 프로세스 두 개 중 DB 디렉터리 FD 보유 프로세스 감지 확인', flush=True)
(control / 'close').touch()
for _ in range(120):
    if (control / 'closed').exists(): break
    time.sleep(.5)
else:
    raise SystemExit('시험 FD 닫기 대기 시간 초과')
result = module.observe_known_processes([holder, other], data, database)
assert not result[holder] and not result[other], result
print('두 시험 프로세스의 DB 참조가 없는 순간 상태 확인', flush=True)
subprocess.run(['/usr/bin/systemctl', 'stop', unit], check=True, timeout=60)
for _ in range(60):
    if not (module.PROC / str(other)).exists(): break
    time.sleep(.5)
else:
    raise SystemExit('시험 프로세스 종료 대기 시간 초과')
try:
    module.observe_known_processes([holder, other], data, database)
except (OSError, ValueError):
    print('목록의 시험 프로세스가 사라지면 안전 판정 대신 오류 확인', flush=True)
else:
    raise SystemExit('사라진 시험 프로세스를 잘못 허용했습니다.')
(control / 'stop').touch()
PY
if ! systemctl stop "$holder" 2>/dev/null; then
  [[ $(systemctl show "$holder" -p LoadState --value) == not-found ]] || {
    echo '시험 서비스 정지 상태를 확인하지 못했습니다.' >&2; false;
  }
fi
umount "$data"
trap - ERR
echo "시험 서비스와 마운트 정리 완료; 시험 자료 보관: $records $data $control $code"
echo '명시한 두 PID만 검사했습니다. 다른 프로세스 열거·새 참조 생성·지속 차단은 보장하지 않습니다.'
