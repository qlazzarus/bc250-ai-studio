#!/usr/bin/env bash
# Observe chmod limits using only a disposable SQLite database in the test VM.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
for tool in systemd-run runuser python3; do command -v "$tool" >/dev/null || exit 1; done
records=$(mktemp -d /var/backups/bc250-db-permissions.XXXXXXXX)
fixture=$(mktemp -d /var/lib/bc250-db-permissions.XXXXXXXX)
code=$(mktemp -d /opt/bc250-db-permissions.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
unit="bc250-db-permissions-$suffix.service"
[[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
trap 'systemctl stop "$unit" >/dev/null 2>&1 || true; echo "시험 중단. 시험 자료 보관: $records $fixture $code" >&2' ERR
chmod 0755 "$code"
chown ai-studio:ai-studio "$fixture"
chmod 0700 "$fixture"
cat > "$code/worker.py" <<'PY'
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

root = Path(sys.argv[1])
connection = sqlite3.connect(root / 'fixture.sqlite3', timeout=10)
assert connection.execute('PRAGMA journal_mode=WAL').fetchone()[0].lower() == 'wal'
connection.execute('CREATE TABLE fixture (value TEXT NOT NULL)')
connection.commit()
(root / 'ready').write_text('ready\n')
deadline = time.monotonic() + 120
while not (root / 'continue').exists():
    if time.monotonic() >= deadline:
        raise SystemExit('시험 신호 대기 시간 초과')
    time.sleep(.1)
result = {'wal_write': None}
try:
    connection.execute("INSERT INTO fixture VALUES ('after-chmod')")
    connection.commit()
    result['wal_write'] = '성공'
except sqlite3.Error as error:
    connection.rollback()
    result['wal_write'] = '실패'
    result['sqlite_error'] = getattr(error, 'sqlite_errorname', '확인 불가')
finally:
    connection.close()
temporary = root / 'result.tmp'
temporary.write_text(json.dumps(result, ensure_ascii=False) + '\n')
os.replace(temporary, root / 'result.json')
PY
chmod 0644 "$code/worker.py"
restorecon -RF "$fixture" "$code" "$records"
systemd-run --quiet --unit="$unit" --property=Type=exec --property=User=ai-studio \
  --property=Group=ai-studio --property=KillMode=control-group \
  /usr/bin/python3 -u "$code/worker.py" "$fixture"
ready=no
for _ in {1..90}; do
  if [[ -f $fixture/ready ]]; then ready=yes; break; fi
  systemctl is-active --quiet "$unit" || { echo '시험 SQLite 프로세스가 종료됐습니다.' >&2; false; }
  sleep .5
done
[[ $ready == yes && -f $fixture/fixture.sqlite3-wal ]] || { echo '시험 SQLite 준비 실패' >&2; false; }
runuser -u ai-studio -- python3 - "$fixture/fixture.sqlite3" <<'PY'
import os
import sys
fd = os.open(sys.argv[1], os.O_RDWR)
os.close(fd)
print('권한 변경 전 시험 DB의 새 쓰기 열기 확인', flush=True)
PY
chmod 0400 "$fixture/fixture.sqlite3"
runuser -u ai-studio -- python3 - "$fixture/fixture.sqlite3" <<'PY'
import os
import sys
try:
    fd = os.open(sys.argv[1], os.O_RDWR)
except PermissionError:
    print('시험 DB의 새 쓰기 열기는 권한 변경 후 거절 확인', flush=True)
else:
    os.close(fd)
    raise SystemExit('시험 DB의 새 쓰기 열기가 허용됐습니다.')
PY
touch "$fixture/continue"
done=no
for _ in {1..90}; do
  if [[ -f $fixture/result.json ]]; then done=yes; break; fi
  if ! systemctl is-active --quiet "$unit"; then
    [[ -f $fixture/result.json ]] && { done=yes; break; }
    echo '시험 SQLite 결과 없이 프로세스가 종료됐습니다.' >&2
    false
  fi
  sleep .5
done
[[ $done == yes ]] || { echo '시험 SQLite 결과 대기 시간 초과' >&2; false; }
python3 - "$fixture/result.json" <<'PY'
import json
import sys
from pathlib import Path
result = json.loads(Path(sys.argv[1]).read_text())
if result.get('wal_write') not in {'성공', '실패'}:
    raise SystemExit('시험 SQLite 결과 형식 오류')
print('권한 변경 전 열린 SQLite 연결의 WAL 커밋:', result['wal_write'], flush=True)
if 'sqlite_error' in result:
    print('시험 SQLite 오류 분류:', result['sqlite_error'], flush=True)
PY
runuser -u ai-studio -- python3 - "$fixture/fixture.sqlite3" <<'PY'
import os
import sys
os.chmod(sys.argv[1], 0o600)
fd = os.open(sys.argv[1], os.O_RDWR)
os.close(fd)
print('시험 소유자 계정이 파일 권한을 되돌리고 다시 열 수 있음 확인', flush=True)
PY
# Use a separate disposable file: never replace the SQLite fixture itself.
install -o root -g root -m 0400 /dev/null "$fixture/owner-probe"
restorecon -F "$fixture/owner-probe"
runuser -u ai-studio -- python3 - "$fixture/owner-probe" <<'PY'
import os
import sys
path = sys.argv[1]
try:
    os.chmod(path, 0o600)
except PermissionError:
    print('root 소유 시험 파일의 소유자 권한 복원 거절 확인', flush=True)
else:
    raise SystemExit('시험 계정이 root 소유 파일 권한을 변경했습니다.')
try:
    os.unlink(path)
except PermissionError:
    print('쓰기 가능한 시험 상위 디렉터리에서 파일 삭제 거절 관찰', flush=True)
else:
    print('쓰기 가능한 시험 상위 디렉터리에서 root 소유 파일 삭제 가능 확인', flush=True)
PY
if ! systemctl stop "$unit" 2>/dev/null; then
  [[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || {
    echo '시험 서비스 정지 상태를 확인하지 못했습니다.' >&2; false;
  }
fi
trap - ERR
echo "시험 서비스 정리 완료; 시험 DB와 기록 보관: $fixture $records $code"
echo '운영 DB·서비스는 변경하지 않았습니다. 시험 결과는 파일 권한 변경의 한계이며 지속 차단 방법을 확정하지 않습니다.'
