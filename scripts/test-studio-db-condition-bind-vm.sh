#!/usr/bin/env bash
# Test a service-specific condition and a read-only bind against a second writer.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
for tool in systemd-run runuser python3 mount umount mountpoint; do command -v "$tool" >/dev/null || exit 1; done
records=$(mktemp -d /var/backups/bc250-db-condition.XXXXXXXX)
fixture=$(mktemp -d /opt/bc250-db-condition.XXXXXXXX)
database=$(mktemp -d /var/lib/bc250-db-condition.XXXXXXXX)
control=$(mktemp -d /var/lib/bc250-db-condition-control.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
unit="bc250-db-condition-$suffix.service"
other="bc250-db-condition-other-$suffix.service"
unit_file="/etc/systemd/system/$unit"
marker="/run/bc250-db-condition-$suffix"
dropin="/run/systemd/system/$unit.d"
for path in "$unit_file" "$marker" "$dropin"; do [[ ! -e $path && ! -L $path ]] || exit 1; done
for name in "$unit" "$other"; do [[ $(systemctl show "$name" -p LoadState --value) == not-found ]] || exit 1; done
failure() {
  systemctl stop "$unit" "$other" >/dev/null 2>&1 || true
  if mountpoint -q "$database"; then umount "$database" || echo "시험 마운트를 해제하지 못했습니다: $database" >&2; fi
  echo "시험 중단. 시험 unit·조건 및 기록 보존: $unit_file $dropin $marker $records $database $control $fixture" >&2
}
trap failure ERR
chmod 0755 "$fixture"
chown ai-studio:ai-studio "$database" "$control"
chmod 0700 "$database" "$control"
for name in wiki-condition-fence.py wiki-maintenance-fence.py read-systemd-conditions.py \
  verify-wiki-condition.py check-service-cgroup.py; do
  install -o root -g root -m 0644 "$1/deploy/model-control/$name" "$fixture/$name"
done
cat > "$fixture/writer.py" <<'PY'
import sqlite3
import sys
import time
from pathlib import Path

database, control = map(Path, sys.argv[1:])
connection = sqlite3.connect(database / 'fixture.sqlite3')
assert connection.execute('PRAGMA journal_mode=WAL').fetchone()[0].lower() == 'wal'
connection.execute('CREATE TABLE IF NOT EXISTS fixture (value TEXT NOT NULL)')
connection.commit()
(control / 'writer-ready').write_text('ready\n')
while True:
    time.sleep(1)
PY
cat > "$fixture/other.py" <<'PY'
import json
import os
import sys
import time
from pathlib import Path

database, control = map(Path, sys.argv[1:])
directory_fd = os.open(database, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
(control / 'other-ready').write_text('ready\n')
deadline = time.monotonic() + 120
while not (control / 'continue').exists():
    if time.monotonic() >= deadline:
        raise SystemExit('시험 신호 대기 시간 초과')
    time.sleep(.1)
try:
    fd = os.open('fixture.sqlite3', os.O_RDWR | os.O_CLOEXEC, dir_fd=directory_fd)
    try:
        original = os.pread(fd, 16, 0)
        assert original == b'SQLite format 3\x00'
        assert os.pwrite(fd, original, 0) == len(original)
        os.fsync(fd)
    finally:
        os.close(fd)
    result = {'old_directory_write': '성공'}
except OSError as error:
    result = {'old_directory_write': '실패', 'errno': error.errno}
finally:
    os.close(directory_fd)
temporary = control / 'other-result.tmp'
temporary.write_text(json.dumps(result, ensure_ascii=False) + '\n')
os.replace(temporary, control / 'other-result.json')
PY
chmod 0644 "$fixture/writer.py" "$fixture/other.py"
cat > "$unit_file" <<EOF
[Service]
User=ai-studio
Group=ai-studio
ExecStart=/usr/bin/python3 -u $fixture/writer.py $database $control
KillMode=control-group
EOF
restorecon -RF "$fixture" "$database" "$control" "$records"
restorecon -F "$unit_file"
systemctl daemon-reload
systemctl start "$unit"
systemd-run --quiet --unit="$other" --property=Type=exec --property=User=ai-studio \
  --property=Group=ai-studio --property=KillMode=control-group \
  /usr/bin/python3 -u "$fixture/other.py" "$database" "$control"
python3 - "$fixture" "$records" "$database" "$control" "$unit" "$other" "$marker" <<'PY'
import errno
import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

fixture, records, database, control = map(Path, sys.argv[1:5])
unit, other, marker = sys.argv[5], sys.argv[6], Path(sys.argv[7])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fixture_fence', fixture / 'wiki-condition-fence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.UNIT = unit
module.MARKER_DIR = marker

def ctl(*args, check=True):
    return subprocess.run(['/usr/bin/systemctl', *args], check=check, timeout=120,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

for _ in range(120):
    if (control / 'writer-ready').exists() and (control / 'other-ready').exists():
        break
    time.sleep(.5)
else:
    raise SystemExit('시험 DB 프로세스 준비 시간 초과')
fence_dir = records / 'fence'
fence_dir.mkdir(mode=0o700)
fence = module.WikiConditionFence(fixture, fence_dir)
assert fence.acquire() is True and fence.check() is True
ctl('start', unit, check=False)
assert fence.check() is True
print('시험 Studio 서비스 정지 및 systemd 재시작 차단 확인', flush=True)
subprocess.run(['/usr/bin/mount', '--bind', str(database), str(database)], check=True)
subprocess.run(['/usr/bin/mount', '-o', 'remount,bind,ro', str(database)], check=True)
probe = '''import errno,os,sys
try:
    fd=os.open(sys.argv[1],os.O_RDWR)
except OSError as error:
    if error.errno != errno.EROFS: raise
else:
    os.close(fd)
    raise SystemExit("새 쓰기 열기가 허용됐습니다.")
'''
subprocess.run(['/usr/sbin/runuser', '-u', 'ai-studio', '--', '/usr/bin/python3', '-c', probe,
                str(database / 'fixture.sqlite3')], check=True)
assert fence.check() is True
print('시험 읽기 전용 경로의 새로운 직접 쓰기 열기 거절 확인', flush=True)
(control / 'continue').touch()
for _ in range(120):
    if (control / 'other-result.json').exists():
        break
    time.sleep(.5)
else:
    raise SystemExit('별도 시험 프로세스 결과 대기 시간 초과')
result = json.loads((control / 'other-result.json').read_text())
if result.get('old_directory_write') not in {'성공', '실패'}:
    raise SystemExit('별도 시험 프로세스 결과 형식 오류')
print('정지한 서비스 밖의 기존 디렉터리 FD를 통한 DB 쓰기:', result, flush=True)
assert fence.check() is True
ctl('stop', other, check=False)
subprocess.run(['/usr/bin/umount', str(database)], check=True)
assert fence.release(can_release=lambda: True) is True  # 시험 전용 해제 조건
assert ctl('is-active', '--quiet', unit, check=False).returncode == 0
print('시험 차단 해제 후 이전 서비스 실행 상태 복원 확인', flush=True)
PY
systemctl stop "$unit"
rm -- "$unit_file"
systemctl daemon-reload
trap - ERR
echo "시험 unit과 마운트 정리 완료; 기록 보관: $records $database $control $fixture"
echo '운영 서비스·DB는 변경하지 않았습니다. 특정 시험 unit만 차단했으며 다른 프로세스와 네임스페이스의 지속 차단은 보장하지 않습니다.'
