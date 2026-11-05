#!/usr/bin/env bash
# Test a read-only bind mount against pre-existing descriptors in the VM only.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
for tool in systemd-run runuser python3 mount umount; do command -v "$tool" >/dev/null || exit 1; done
records=$(mktemp -d /var/backups/bc250-db-bind.XXXXXXXX)
fixture=$(mktemp -d /var/lib/bc250-db-bind.XXXXXXXX)
control=$(mktemp -d /var/lib/bc250-db-control.XXXXXXXX)
code=$(mktemp -d /opt/bc250-db-bind.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
unit="bc250-db-bind-$suffix.service"
[[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
mounted=no
failure() {
  systemctl stop "$unit" >/dev/null 2>&1 || true
  if [[ $mounted == yes ]]; then
    umount "$fixture" || echo "시험 마운트를 해제하지 못했습니다: $fixture" >&2
  fi
  echo "시험 중단. 시험 자료 보관: $records $fixture $control $code" >&2
}
trap failure ERR
chmod 0755 "$code"
chown ai-studio:ai-studio "$fixture" "$control"
chmod 0700 "$fixture" "$control"
cat > "$code/worker.py" <<'PY'
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

root, control = map(Path, sys.argv[1:])
directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
connection = sqlite3.connect(root / 'fixture.sqlite3', timeout=10)
assert connection.execute('PRAGMA journal_mode=WAL').fetchone()[0].lower() == 'wal'
connection.execute('CREATE TABLE fixture (value TEXT NOT NULL)')
connection.commit()
(control / 'ready').write_text('ready\n')
deadline = time.monotonic() + 120
while not (control / 'continue').exists():
    if time.monotonic() >= deadline:
        raise SystemExit('시험 신호 대기 시간 초과')
    time.sleep(.1)
result = {}
try:
    fd = os.open('fixture.sqlite3', os.O_RDWR | os.O_CLOEXEC, dir_fd=directory_fd)
except OSError as error:
    result['old_directory_open'] = {'status': '실패', 'errno': error.errno}
else:
    os.close(fd)
    result['old_directory_open'] = {'status': '성공'}
try:
    connection.execute("INSERT INTO fixture VALUES ('after-bind')")
    connection.commit()
    result['wal_write'] = {'status': '성공'}
except sqlite3.Error as error:
    connection.rollback()
    result['wal_write'] = {'status': '실패', 'sqlite_error': getattr(error, 'sqlite_errorname', '확인 불가')}
finally:
    connection.close()
    os.close(directory_fd)
temporary = control / 'result.tmp'
temporary.write_text(json.dumps(result, ensure_ascii=False) + '\n')
os.replace(temporary, control / 'result.json')
PY
chmod 0644 "$code/worker.py"
restorecon -RF "$fixture" "$control" "$code" "$records"
systemd-run --quiet --unit="$unit" --property=Type=exec --property=User=ai-studio \
  --property=Group=ai-studio --property=KillMode=control-group \
  /usr/bin/python3 -u "$code/worker.py" "$fixture" "$control"
ready=no
for _ in {1..90}; do
  if [[ -f $control/ready ]]; then ready=yes; break; fi
  systemctl is-active --quiet "$unit" || { echo '시험 SQLite 프로세스가 종료됐습니다.' >&2; false; }
  sleep .5
done
[[ $ready == yes && -f $fixture/fixture.sqlite3-wal ]] || { echo '시험 SQLite 준비 실패' >&2; false; }
runuser -u ai-studio -- python3 - "$fixture/fixture.sqlite3" <<'PY'
import os
import sys
fd = os.open(sys.argv[1], os.O_RDWR)
os.close(fd)
print('시험 마운트 전 DB 새 쓰기 열기 확인', flush=True)
PY
mount --bind "$fixture" "$fixture"
mounted=yes
mount -o remount,bind,ro "$fixture"
runuser -u ai-studio -- python3 - "$fixture/fixture.sqlite3" <<'PY'
import errno
import os
import sys
try:
    fd = os.open(sys.argv[1], os.O_RDWR)
except OSError as error:
    if error.errno != errno.EROFS:
        raise
    print('읽기 전용 시험 마운트에서 새 쓰기 열기 거절 확인', flush=True)
else:
    os.close(fd)
    raise SystemExit('읽기 전용 시험 마운트에서 새 쓰기 열기가 허용됐습니다.')
try:
    os.chmod(sys.argv[1], 0o600)
except OSError as error:
    if error.errno != errno.EROFS:
        raise
    print('읽기 전용 시험 마운트에서 소유자의 권한 변경 거절 확인', flush=True)
else:
    raise SystemExit('읽기 전용 시험 마운트에서 권한 변경이 허용됐습니다.')
PY
touch "$control/continue"
done=no
for _ in {1..90}; do
  if [[ -f $control/result.json ]]; then done=yes; break; fi
  if ! systemctl is-active --quiet "$unit"; then
    [[ -f $control/result.json ]] && { done=yes; break; }
    echo '시험 SQLite 결과 없이 프로세스가 종료됐습니다.' >&2
    false
  fi
  sleep .5
done
[[ $done == yes ]] || { echo '시험 SQLite 결과 대기 시간 초과' >&2; false; }
python3 - "$control/result.json" <<'PY'
import json
import sys
from pathlib import Path
result = json.loads(Path(sys.argv[1]).read_text())
for name, label in (('old_directory_open', '기존 디렉터리 FD를 통한 새 쓰기 열기'),
                    ('wal_write', '기존 SQLite 연결의 WAL 커밋')):
    value = result.get(name)
    if not isinstance(value, dict) or value.get('status') not in {'성공', '실패'}:
        raise SystemExit('시험 결과 형식 오류')
    print(label + ':', value, flush=True)
PY
if ! systemctl stop "$unit" 2>/dev/null; then
  [[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || {
    echo '시험 서비스 정지 상태를 확인하지 못했습니다.' >&2; false;
  }
fi
umount "$fixture"
mounted=no
trap - ERR
echo "시험 서비스와 마운트 정리 완료; 시험 DB와 기록 보관: $fixture $control $records $code"
echo '운영 DB·서비스는 변경하지 않았습니다. 별도 마운트와 열린 FD의 시험이며 전체 지속 차단을 보장하지 않습니다.'
