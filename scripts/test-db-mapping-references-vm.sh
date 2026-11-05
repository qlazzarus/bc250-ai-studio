#!/usr/bin/env bash
# Observe a file-backed shared mapping after its original FD has closed.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 \
  && -f $1/deploy/model-control/observe-db-process-references.py ]] || exit 1
for tool in systemd-run python3 mount umount mountpoint; do command -v "$tool" >/dev/null || exit 1; done
records=$(mktemp -d /var/backups/bc250-db-mapping.XXXXXXXX)
data=$(mktemp -d /var/lib/bc250-db-mapping.XXXXXXXX)
control=$(mktemp -d /var/lib/bc250-db-map-control.XXXXXXXX)
code=$(mktemp -d /opt/bc250-db-mapping.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
unit="bc250-db-mapping-$suffix.service"
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
import ctypes
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

root, control = map(Path, sys.argv[1:])
directory = root / 'database'
directory.mkdir(mode=0o700)
database = directory / 'studio.sqlite3'
connection = sqlite3.connect(database)
connection.execute('CREATE TABLE fixture (value TEXT)')
connection.commit()
connection.close()
fd = os.open(database, os.O_RDWR | os.O_CLOEXEC)
size = os.fstat(fd).st_size
libc = ctypes.CDLL(None, use_errno=True)
libc.mmap.restype = ctypes.c_void_p
libc.mmap.argtypes = (ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int,
                      ctypes.c_int, ctypes.c_int, ctypes.c_longlong)
libc.msync.argtypes = (ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int)
libc.munmap.argtypes = (ctypes.c_void_p, ctypes.c_size_t)
address = libc.mmap(None, size, 3, 1, fd, 0)  # PROT_READ|WRITE, MAP_SHARED
if address == ctypes.c_void_p(-1).value:
    raise OSError(ctypes.get_errno(), 'mmap')
info = os.fstat(fd)
matches = []
for row in Path('/proc/self/maps').read_text(encoding='utf-8', errors='surrogateescape').splitlines():
    fields = row.split(maxsplit=5)
    if len(fields) >= 5 and (fields[4] == str(info.st_ino)
                              or (len(fields) == 6 and 'studio.sqlite3' in fields[5])):
        matches.append((fields[1], fields[3], fields[4]))
(control / 'mapped-at-creation.json').write_text(json.dumps({
    'device': f'{os.major(info.st_dev):x}:{os.minor(info.st_dev):x}',
    'inode': info.st_ino, 'mappings': matches,
}) + '\n')
os.close(fd)
(control / 'ready').write_text('ready\n')
deadline = time.monotonic() + 120
while not (control / 'write').exists():
    if time.monotonic() >= deadline: raise SystemExit('시험 쓰기 대기 시간 초과')
    time.sleep(.1)
header = ctypes.string_at(address, 16)
assert header == b'SQLite format 3\x00'
ctypes.memmove(address, header, len(header))
if libc.msync(address, size, 4) != 0:  # MS_SYNC
    raise OSError(ctypes.get_errno(), 'msync')
(control / 'written').write_text('written\n')
while not (control / 'unmap').exists():
    if time.monotonic() >= deadline: raise SystemExit('시험 매핑 해제 대기 시간 초과')
    time.sleep(.1)
if libc.munmap(address, size) != 0:
    raise OSError(ctypes.get_errno(), 'munmap')
(control / 'unmapped').write_text('unmapped\n')
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
python3 - "$control/mapped-at-creation.json" <<'PY'
import json
import sys
from pathlib import Path
print('매핑 생성 직후 시험 프로세스 관찰:', json.loads(Path(sys.argv[1]).read_text()), flush=True)
PY
pid=$(systemctl show "$unit" -p MainPID --value)
[[ $pid =~ ^[0-9]+$ && $pid -gt 1 ]] || exit 1
mount --bind "$data" "$data"
mount -o remount,bind,ro "$data"
python3 - "$1/deploy/model-control/observe-db-process-references.py" "$pid" "$data" "$control" <<'PY'
import importlib.util
import os
import sys
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('db_references', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
pid, data, control = int(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
database = data / 'database/studio.sqlite3'
stat = database.stat()
print('시험 DB 장치 major:minor 및 inode:',
      f'{os.major(stat.st_dev):x}:{os.minor(stat.st_dev):x}', stat.st_ino, flush=True)
rows = (module.PROC / str(pid) / 'maps').read_text(encoding='utf-8', errors='surrogateescape').splitlines()
matches = []
for row in rows:
    fields = row.split(maxsplit=5)
    if len(fields) >= 5 and (fields[4] == str(stat.st_ino)
                              or (len(fields) == 6 and 'studio.sqlite3' in fields[5])):
        matches.append((fields[1], fields[3], fields[4]))
        try:
            mapped = (module.PROC / str(pid) / 'map_files' / fields[0]).stat()
        except OSError as error:
            print('시험 map_files 확인 실패:', type(error).__name__, 'errno=', error.errno, flush=True)
        else:
            print('시험 map_files 장치 major:minor 및 inode:',
                  f'{os.major(mapped.st_dev):x}:{os.minor(mapped.st_dev):x}', mapped.st_ino, flush=True)
print('시험 DB와 이름 또는 inode가 일치하는 매핑의 권한·장치·inode:', matches, flush=True)
result = module.observe_process(pid, data, database)
assert 'mapping' in result and 'fd' not in result, result
print('FD를 닫은 시험 프로세스의 DB 메모리 매핑 감지 확인', flush=True)
(control / 'write').touch()
for _ in range(120):
    if (control / 'written').exists(): break
    time.sleep(.5)
else:
    raise SystemExit('시험 매핑 쓰기 대기 시간 초과')
print('읽기 전용 마운트 전 생성한 공유 매핑의 쓰기와 동기화 확인', flush=True)
(control / 'unmap').touch()
for _ in range(120):
    if (control / 'unmapped').exists(): break
    time.sleep(.5)
else:
    raise SystemExit('시험 매핑 해제 대기 시간 초과')
assert module.observe_process(pid, data, database) == frozenset()
print('시험 프로세스의 DB 매핑 해제 후 참조 없음 확인', flush=True)
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
echo '지정한 한 프로세스의 순간 검사입니다. 다른 프로세스·새 참조 생성이나 지속 차단은 확인하지 않습니다.'
