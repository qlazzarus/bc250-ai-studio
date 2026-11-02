#!/usr/bin/env bash
# Exercise the read-only rollback gate on disposable Fedora VM files only.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 1 && -f $1/deploy/model-control/check-new-switch-state.py ]] || exit 1
fixture=$(mktemp -d /var/backups/bc250-switch-state-check.XXXXXXXX)
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture" >&2' ERR
python3 - "$1/deploy/model-control/check-new-switch-state.py" "$fixture" <<'PY'
import importlib.util
import shutil
import sqlite3
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('check_state', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = Path(sys.argv[2])
state, gate = root / 'state', root / 'gate'
state.mkdir(); gate.mkdir()
(state / 'switch.json').write_text('{}\n')
(gate / 'holds.json').write_text('{"holds":["startup","legacy"]}\n')
db = sqlite3.connect(state / 'operations.sqlite3')
db.execute('create table switch_operations (state text not null)')
db.execute("insert into switch_operations values ('succeeded')")
db.commit(); db.close()
assert module.check(state, gate)
for target, value in ((state / 'switch.json', '{"phase":"switching"}'),
                      (gate / 'holds.json', '{"holds":["switch-fixture"]}')):
    original = target.read_text()
    target.write_text(value)
    try:
        module.check(state, gate)
    except ValueError:
        pass
    else:
        raise SystemExit('미완료 journal 또는 보류를 잘못 허용했습니다.')
    target.write_text(original)
print('빈 journal·완료 작업 통과 및 미완료 journal·전환 hold 거절 확인', flush=True)

# Check that a committed operation present only in WAL is not overlooked.
live = root / 'wal-live'
wal_copy = root / 'wal-preserved'
live.mkdir(); wal_copy.mkdir()
(wal_copy / 'switch.json').write_text('{}\n')
db = sqlite3.connect(live / 'operations.sqlite3')
assert db.execute('PRAGMA journal_mode=WAL').fetchone()[0] == 'wal'
db.execute('create table switch_operations (state text not null)')
db.commit()
db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
db.execute("insert into switch_operations values ('recovery_required')")
db.commit()
for suffix in ('', '-wal', '-shm'):
    file = live / ('operations.sqlite3' + suffix)
    if file.exists():
        shutil.copyfile(file, wal_copy / file.name)
db.close()
assert (wal_copy / 'operations.sqlite3-wal').is_file()
try:
    module.check(wal_copy, gate)
except ValueError:
    pass
else:
    raise SystemExit('WAL의 미완료 작업을 잘못 허용했습니다.')
print('보존된 WAL에만 있는 미완료 작업 거절 확인', flush=True)
PY
echo "시험 파일 보관: $fixture"
