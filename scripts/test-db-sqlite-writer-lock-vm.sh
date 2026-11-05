#!/usr/bin/env bash
# Only a disposable SQLite database; this is not a complete DB write fence.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
fixture=$(mktemp -d /var/lib/bc250-sqlite-lock.XXXXXXXX)
trap 'echo "시험 중단. 시험 DB 보관: $fixture" >&2' ERR
restorecon -RF "$fixture"
python3 - "$fixture" "$1" <<'PY'
import importlib.util
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

db = Path(sys.argv[1]) / 'fixture.sqlite3'
setup = sqlite3.connect(db)
assert setup.execute('PRAGMA journal_mode=WAL').fetchone()[0].lower() == 'wal'
setup.execute('CREATE TABLE fixture (value TEXT)')
setup.commit()
setup.close()
child = r'''
import sqlite3, sys
connection = sqlite3.connect(sys.argv[1], timeout=0)
print('ready', flush=True)
for command in sys.stdin:
    if command.strip() != 'write': raise SystemExit(2)
    try:
        connection.execute("INSERT INTO fixture VALUES ('writer')")
        connection.commit()
    except sqlite3.OperationalError as error:
        connection.rollback()
        print(getattr(error, 'sqlite_errorname', 'unknown'), flush=True)
    else:
        print('committed', flush=True)
connection.close()
'''
writer = subprocess.Popen(['/usr/bin/python3', '-u', '-c', child, str(db)],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
guard = None
try:
    if writer.stdout.readline().strip() != 'ready':
        raise RuntimeError('기존 시험 SQLite 연결 준비 실패')
    guard = sqlite3.connect(db, timeout=0)
    guard.execute('BEGIN IMMEDIATE')
    writer.stdin.write('write\n')
    writer.stdin.flush()
    if writer.stdout.readline().strip() != 'SQLITE_BUSY':
        raise RuntimeError('시험 잠금 중 기존 연결의 SQLite 쓰기 거절을 확인하지 못했습니다.')
    print('시험 잠금 보유 중 기존 SQLite 연결의 쓰기 거절 확인', flush=True)
    guard.rollback()
    guard.close()
    guard = None
    writer.stdin.write('write\n')
    writer.stdin.flush()
    if writer.stdout.readline().strip() != 'committed':
        raise RuntimeError('시험 잠금 해제 후 SQLite 쓰기를 확인하지 못했습니다.')
    print('시험 잠금 해제 후 기존 SQLite 연결의 쓰기 성공 확인', flush=True)
    writer.stdin.close()
    if writer.wait(timeout=30):
        raise RuntimeError('시험 SQLite 프로세스 종료 실패')
finally:
    if guard is not None:
        guard.rollback()
        guard.close()
    if writer.poll() is None:
        writer.kill()
        writer.wait()
print('SQLite 협조 쓰기만 시험했습니다. 직접 파일 쓰기·잠금 지속성·실제 서비스와 백업은 검증하지 않았습니다.', flush=True)
candidate_path = Path(sys.argv[2]) / 'deploy/model-control/sqlite-writer-guard.py'
spec = importlib.util.spec_from_file_location('fixture_guard', candidate_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
guard = module.SQLiteWriterGuard(db)
try:
    if guard.acquire() is not True or guard.check() is not False:
        raise RuntimeError('후보 SQLite 잠금을 확인하지 못했습니다.')
    competing = sqlite3.connect(db, timeout=0)
    try:
        try:
            competing.execute('BEGIN IMMEDIATE')
        except sqlite3.OperationalError as error:
            if getattr(error, 'sqlite_errorname', '') != 'SQLITE_BUSY':
                raise
        else:
            raise RuntimeError('후보 잠금 중 다른 SQLite 쓰기가 허용됐습니다.')
    finally:
        competing.close()
finally:
    if guard.connection is not None:
        guard.release()
print('시험 SQLite 예약의 초기 거절과 후보 검사기의 안전한 거절 확인', flush=True)
holder_code = '''import sqlite3,sys
c=sqlite3.connect(sys.argv[1],timeout=0,isolation_level=None)
c.execute("BEGIN IMMEDIATE")
print("held",flush=True)
sys.stdin.readline()
c.rollback()
c.close()
'''
holder = subprocess.Popen(['/usr/bin/python3', '-u', '-c', holder_code, str(db)],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
try:
    if holder.stdout.readline().strip() != 'held':
        raise RuntimeError('별도 시험 잠금 프로세스 준비 실패')
    fd = os.open(str(db) + '-shm', os.O_RDONLY)
    os.close(fd)
    contender = sqlite3.connect(db, timeout=0, isolation_level=None)
    try:
        try:
            contender.execute('BEGIN IMMEDIATE')
        except sqlite3.OperationalError as error:
            if getattr(error, 'sqlite_errorname', '') != 'SQLITE_BUSY':
                raise
        else:
            raise RuntimeError('별도 프로세스 잠금 보유 중 SQLite 쓰기가 허용됐습니다.')
        print('별도 잠금 프로세스 유지 중 검사 프로세스의 shm 열기·닫기 후 쓰기 거절 확인', flush=True)
        holder.terminate()
        holder.wait(timeout=30)
        contender.execute('BEGIN IMMEDIATE')
        contender.rollback()
        print('시험 잠금 프로세스 종료 후 SQLite 쓰기 예약 가능 확인', flush=True)
    finally:
        contender.close()
finally:
    if holder.poll() is None:
        holder.kill()
        holder.wait()
print('프로세스 생존 확인·종료 시 중단·직접 파일 쓰기 차단은 별도 구현이 필요합니다.', flush=True)
process_path = Path(sys.argv[2]) / 'deploy/model-control/sqlite-process-guard.py'
spec = importlib.util.spec_from_file_location('fixture_process_guard', process_path)
process_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(process_module)
process_guard = process_module.SQLiteProcessGuard(db)
raw_fd = os.open(db, os.O_RDWR)
try:
    if process_guard.acquire() is not True:
        raise RuntimeError('시험 잠금 후보 시작 실패')
    fd = os.open(str(db) + '-shm', os.O_RDONLY)
    os.close(fd)
    if process_guard.check() is not True:
        raise RuntimeError('시험 검사 뒤 별도 잠금을 확인하지 못했습니다.')
    contender = sqlite3.connect(db, timeout=0, isolation_level=None)
    try:
        try:
            contender.execute('BEGIN IMMEDIATE')
        except sqlite3.OperationalError as error:
            if getattr(error, 'sqlite_errorname', '') != 'SQLITE_BUSY':
                raise
        else:
            raise RuntimeError('시험 잠금 후보에서 경쟁 쓰기가 허용됐습니다.')
        original = os.pread(raw_fd, 1, 0)
        if len(original) != 1 or os.pwrite(raw_fd, original, 0) != 1:
            raise RuntimeError('시험 DB의 기존 FD에 같은 바이트를 다시 쓰지 못했습니다.')
        os.fsync(raw_fd)
        print('SQLite 잠금 중 기존 파일 FD로 같은 바이트 직접 쓰기 가능 확인', flush=True)
        if process_guard.check() is not True:
            raise RuntimeError('직접 쓰기 관찰 중 시험 잠금 후보가 종료됐습니다.')
        process_guard.process.kill()
        process_guard.process.wait(timeout=30)
        if process_guard.check() is not False:
            raise RuntimeError('종료된 시험 잠금 프로세스를 허용했습니다.')
        contender.execute('BEGIN IMMEDIATE')
        contender.rollback()
    finally:
        contender.close()
    print('별도 시험 잠금 후보의 shm 검사 후 경쟁 거절 및 프로세스 종료 감지 확인', flush=True)
finally:
    os.close(raw_fd)
    process_guard.release()
print('후보는 운영 백업에 연결하지 않았으며 직접 쓰기·경합·잠금 유지 보장은 미완성입니다.', flush=True)
PY
trap - ERR
echo "시험 DB 보관: $fixture"
