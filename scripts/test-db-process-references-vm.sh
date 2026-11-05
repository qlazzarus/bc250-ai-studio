#!/usr/bin/env bash
# Observe a known disposable process holding a DB directory descriptor.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 \
  && -f $1/deploy/model-control/observe-db-process-references.py ]] || exit 1
for tool in systemd-run python3 mount umount mountpoint; do command -v "$tool" >/dev/null || exit 1; done
records=$(mktemp -d /var/backups/bc250-db-reference.XXXXXXXX)
data=$(mktemp -d /var/lib/bc250-db-reference.XXXXXXXX)
control=$(mktemp -d /var/lib/bc250-db-ref-control.XXXXXXXX)
code=$(mktemp -d /opt/bc250-db-reference.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
unit="bc250-db-reference-$suffix.service"
[[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
failure() {
  systemctl stop "$unit" >/dev/null 2>&1 || true
  if mountpoint -q "$data"; then umount "$data" || echo "시험 마운트를 해제하지 못했습니다: $data" >&2; fi
  echo "시험 중단. 시험 자료 보관: $records $data $control $code" >&2
}
trap failure ERR
chmod 0755 "$code"
chown ai-studio:ai-studio "$data" "$control"
chmod 0700 "$data" "$control"
cat > "$code/worker.py" <<'PY'
import os
import sqlite3
import sys
import time
from pathlib import Path

root, control = map(Path, sys.argv[1:])
directory = root / 'database'
directory.mkdir(mode=0o700)
connection = sqlite3.connect(directory / 'studio.sqlite3')
connection.execute('CREATE TABLE fixture (value TEXT)')
connection.commit()
connection.close()
fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
(control / 'ready').write_text('ready\n')
deadline = time.monotonic() + 120
while not (control / 'close').exists():
    if time.monotonic() >= deadline: raise SystemExit('시험 대기 시간 초과')
    time.sleep(.1)
os.close(fd)
(control / 'closed').write_text('closed\n')
while not (control / 'stop').exists():
    if time.monotonic() >= deadline: raise SystemExit('시험 종료 대기 시간 초과')
    time.sleep(.1)
PY
chmod 0644 "$code/worker.py"
restorecon -RF "$data" "$control" "$code" "$records"
systemd-run --quiet --unit="$unit" --property=Type=exec --property=User=ai-studio \
  --property=Group=ai-studio --property=KillMode=control-group \
  /usr/bin/python3 -u "$code/worker.py" "$data" "$control"
ready=no
for _ in {1..90}; do
  if [[ -f $control/ready ]]; then ready=yes; break; fi
  systemctl is-active --quiet "$unit" || { echo '시험 프로세스가 종료됐습니다.' >&2; false; }
  sleep .5
done
[[ $ready == yes ]] || { echo '시험 프로세스 준비 시간 초과' >&2; false; }
pid=$(systemctl show "$unit" -p MainPID --value)
[[ $pid =~ ^[0-9]+$ && $pid -gt 1 ]] || exit 1
mount --bind "$data" "$data"
mount -o remount,bind,ro "$data"
python3 - "$1/deploy/model-control/observe-db-process-references.py" "$pid" "$data" "$control" <<'PY'
import importlib.util
import sys
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('db_references', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
pid, data, control = int(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
database = data / 'database/studio.sqlite3'
result = module.observe_process(pid, data, database)
assert 'fd' in result, result
print('읽기 전용 마운트 전 열린 시험 DB 디렉터리 FD 감지 확인', flush=True)
(control / 'close').touch()
for _ in range(120):
    if (control / 'closed').exists(): break
    time.sleep(.5)
else:
    raise SystemExit('시험 FD 닫기 대기 시간 초과')
assert module.observe_process(pid, data, database) == frozenset()
print('시험 프로세스가 FD를 닫은 뒤 해당 참조 없음 확인', flush=True)
(control / 'stop').touch()
PY
if ! systemctl stop "$unit" 2>/dev/null; then
  [[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || {
    echo '시험 서비스 정지 상태를 확인하지 못했습니다.' >&2; false;
  }
fi
umount "$data"
trap - ERR
echo "시험 서비스와 마운트 정리 완료; 시험 자료 보관: $records $data $control $code"
echo '지정한 한 프로세스의 순간 검사입니다. 다른 프로세스·메모리 매핑·새 참조 생성이나 지속 차단은 확인하지 않습니다.'
