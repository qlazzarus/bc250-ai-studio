#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-legacy-db-check.XXXXXXXX)
chmod 0755 "$fixture"
unit=/run/systemd/system/bc250-legacy-db-fixture.service
[[ ! -e $unit && ! -L $unit && ! -e /etc/systemd/system/${unit##*/} \
  && $(systemctl show "${unit##*/}" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $fixture $unit" >&2' ERR
for name in legacy-backup-adapter.py legacy-backup-sequence.py inspect-stopped-studio-db.py sqlite-process-guard.py \
  backup-archive.sh check-service-cgroup.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$fixture/$name"
done
cat > "$unit" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
restorecon -RF "$fixture"
restorecon -F "$unit"
systemctl daemon-reload
python3 - "$fixture" <<'PY'
import importlib.util
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

fixture = Path(sys.argv[1])
sys.dont_write_bytecode = True
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, fixture / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
backup = load('fixture_backup', 'legacy-backup-adapter.py')
sequence = load('fixture_sequence', 'legacy-backup-sequence.py')
database = load('fixture_database', 'inspect-stopped-studio-db.py')
process_guard_module = load('fixture_process_guard', 'sqlite-process-guard.py')
db = fixture / 'studio.sqlite3'
with sqlite3.connect(db) as connection:
    if connection.execute('PRAGMA journal_mode=WAL').fetchone()[0].lower() != 'wal':
        raise SystemExit('시험 DB WAL 모드를 설정하지 못했습니다.')
    connection.execute('CREATE TABLE jobs (status TEXT)')
    connection.execute('CREATE TABLE system_state (key TEXT, value TEXT)')
    connection.execute("INSERT INTO jobs VALUES ('queued')")
connection.close()
backup.UNITS = ('bc250-legacy-db-fixture.service',)
backup.STUDIO_DATABASE = db
adapter = backup.LegacyBackupAdapter.__new__(backup.LegacyBackupAdapter)
adapter.source = fixture
adapter.sequence = sequence
adapter.studio_db = database
adapter.llama_connections = SimpleNamespace(check_host_llama=lambda: True)
adapter.maintenance = lambda: True
adapter.check_local_idle = lambda: True
adapter.check_database_fence = lambda: True  # fixture only
gate = {'paused': True, 'active_requests': 0, 'waiting_requests': 0}
adapter.capture_pause = lambda: gate
adapter.gate_status = lambda: gate
adapter.stop = lambda: subprocess.run(['/usr/bin/systemctl', 'stop', backup.UNITS[0]], check=True)
events = []
adapter.create_backup = lambda: events.append('backup') or fixture / 'fake-backup'
adapter.verify_backup = lambda _: events.append('verified')
subprocess.run(['/usr/bin/systemctl', 'start', backup.UNITS[0]], check=True)
try:
    adapter.run()
except sequence.SequenceError as exc:
    if not isinstance(exc.__cause__, ValueError) or '완료되지 않은' not in str(exc.__cause__):
        raise
else:
    raise SystemExit('대기 작업이 있는 시험 백업이 허용됐습니다.')
if events:
    raise SystemExit('대기 작업 거절 전에 시험 백업이 생성됐습니다.')
print('정지된 시험 Studio에 대기 작업이 있으면 백업 전 중단 확인', flush=True)
with sqlite3.connect(db) as connection:
    connection.execute("UPDATE jobs SET status='completed'")
connection.close()
fence = {'held': False}
adapter.check_database_fence = lambda: fence['held']
try:
    adapter.run()
except sequence.SequenceError as exc:
    if not isinstance(exc.__cause__, RuntimeError) or 'DB 검사 전' not in str(exc.__cause__):
        raise
else:
    raise SystemExit('시험 DB 차단이 없는데 백업이 허용됐습니다.')
if events:
    raise SystemExit('시험 DB 차단 확인 전에 백업이 생성됐습니다.')
print('모의 DB 쓰기 차단이 없으면 DB 검사와 백업 전 중단 확인', flush=True)
fence['held'] = True
def inspect_and_lose_fence(*args, **kwargs):
    result = database.inspect(*args, **kwargs)
    fence['held'] = False
    return result
adapter.studio_db = SimpleNamespace(inspect=inspect_and_lose_fence)
try:
    adapter.run()
except sequence.SequenceError as exc:
    if not isinstance(exc.__cause__, RuntimeError) or 'DB 검사' not in str(exc.__cause__):
        raise
else:
    raise SystemExit('시험 DB 차단 상실 후 백업이 허용됐습니다.')
if events:
    raise SystemExit('시험 DB 차단 상실 후 백업이 생성됐습니다.')
print('시험 DB 검사 중 모의 쓰기 차단 상실 시 백업 전 중단 확인', flush=True)
adapter.studio_db = database
fence['held'] = True
if adapter.run() != fixture / 'fake-backup' or events != ['backup', 'verified']:
    raise SystemExit('유휴 시험 Studio의 백업 연결에 실패했습니다.')
print('정지된 시험 Studio DB 검사 후 백업 연결 확인', flush=True)
events.clear()
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
        raise RuntimeError('시험 SQLite 잠금 프로세스 준비 실패')
    # Process liveness is a test signal only, not proof of the real fence.
    adapter.check_database_fence = lambda: holder.poll() is None and fence['held']
    def inspect_and_stop_holder(*args, **kwargs):
        result = database.inspect(*args, **kwargs)
        holder.terminate()
        holder.wait(timeout=30)
        return result
    adapter.studio_db = SimpleNamespace(inspect=inspect_and_stop_holder)
    try:
        adapter.run()
    except sequence.SequenceError as exc:
        if not isinstance(exc.__cause__, RuntimeError) or 'DB 검사' not in str(exc.__cause__):
            raise
    else:
        raise SystemExit('시험 잠금 프로세스 종료 후 백업이 허용됐습니다.')
    if events:
        raise SystemExit('시험 잠금 프로세스 종료 후 백업이 생성됐습니다.')
    print('시험 DB 검사 중 별도 SQLite 잠금 프로세스 종료 시 백업 전 중단 확인', flush=True)
finally:
    if holder.poll() is None:
        holder.kill()
        holder.wait()
guard = process_guard_module.SQLiteProcessGuard(db)
try:
    guard.acquire()
    adapter.studio_db = database
    # The second half represents a separate, simulated raw-write fence.
    adapter.check_database_fence = lambda: guard.check() and fence['held']
    def fake_backup_with_guard():
        code = ('import sqlite3,sys\n'
                'c=sqlite3.connect(sys.argv[1], timeout=0)\n'
                'try: c.execute("BEGIN IMMEDIATE")\n'
                'except sqlite3.OperationalError as e:\n'
                ' sys.exit(0 if getattr(e,"sqlite_errorname","")=="SQLITE_BUSY" else 2)\n'
                'else: sys.exit(1)\n')
        subprocess.run(['/usr/bin/python3', '-c', code, str(db)], check=True, timeout=30)
        events.append('backup')
        return fixture / 'fake-backup'
    adapter.create_backup = fake_backup_with_guard
    if adapter.run() != fixture / 'fake-backup' or events != ['backup', 'verified']:
        raise SystemExit('별도 시험 잠금 후보와 백업 경계 연결 실패')
    print('별도 시험 잠금 후보 유지 중 DB 검사와 모의 백업 경계 확인', flush=True)
    if guard.check() is not True:
        raise SystemExit('시험 DB 아카이브 전 SQLite 예약이 없습니다.')
    archive = fixture / 'sqlite-fixture.tar'
    names = [path.name for path in (db, Path(str(db) + '-wal'), Path(str(db) + '-shm')) if path.exists()]
    subprocess.run(['/usr/bin/tar', '-cf', str(archive), '-C', str(fixture), *names], check=True, timeout=30)
    if guard.check() is not True:
        raise SystemExit('시험 DB 아카이브 후 SQLite 예약이 없습니다. 아카이브를 보존합니다.')
    with tempfile.TemporaryDirectory(prefix='sqlite-copy-', dir=fixture) as directory:
        subprocess.run(['/usr/bin/tar', '-xf', str(archive), '-C', directory], check=True, timeout=30)
        copied = sqlite3.connect(Path(directory) / db.name)
        try:
            if copied.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                raise SystemExit('시험 DB 아카이브의 무결성 확인 실패')
            if copied.execute('SELECT status FROM jobs').fetchall() != [('completed',)]:
                raise SystemExit('시험 DB 아카이브의 작업 상태 확인 실패')
        finally:
            copied.close()
    print('별도 시험 잠금 후보 유지 중 시험 DB 아카이브와 복사본 무결성 확인', flush=True)
    # Exercise the real archive function on an entirely synthetic filesystem.
    live = fixture / 'archive-root'
    output = fixture / 'archive-backup'
    live.mkdir(mode=0o700)
    output.mkdir(mode=0o700)
    for name in ('opt/bc250-ai-studio', 'opt/ai-studio-data/database'):
        (live / name).mkdir(parents=True)
    files = ('etc/bc250-ai-studio.env', 'etc/bc250-llm-gate.env', 'etc/bc250-llm-client.env',
             'etc/systemd/system/bc250-ai-studio.service', 'etc/systemd/system/bc250-llm-gate.service',
             'etc/systemd/system/bc250-llm-client.service', 'opt/ai/config/active-model.conf',
             'var/lib/bc250-model-control/legacy-pause.json')
    for name in files:
        path = live / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('fixture\n')
    caddy = fixture / 'caddy-original'
    caddy.write_text('fixture\n')
    archive_db = live / 'opt/ai-studio-data/database/studio.sqlite3'
    setup = sqlite3.connect(archive_db)
    setup.execute('PRAGMA journal_mode=WAL')
    setup.execute('CREATE TABLE jobs(status TEXT)')
    setup.execute("INSERT INTO jobs VALUES ('completed')")
    setup.commit()
    setup.close()
    archive_guard = process_guard_module.SQLiteProcessGuard(archive_db)
    try:
        archive_guard.acquire()
        subprocess.run(['/usr/bin/bash', '-c', 'source "$1"; bc250_backup_archive "$2" "$3" "$4"',
                        'fixture-archive', str(fixture / 'backup-archive.sh'), str(live), str(output), str(caddy)],
                       check=True, timeout=120)
        if archive_guard.check() is not True:
            raise RuntimeError('시험 전체 아카이브 후 SQLite 예약을 확인하지 못했습니다.')
        with tempfile.TemporaryDirectory(prefix='archive-copy-', dir=fixture) as directory:
            subprocess.run(['/usr/bin/tar', '-xf', str(output / 'legacy.tar'), '-C', directory], check=True, timeout=30)
            copied = sqlite3.connect(Path(directory) / 'opt/ai-studio-data/database/studio.sqlite3')
            try:
                if copied.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                    raise RuntimeError('시험 전체 아카이브의 DB 무결성 확인 실패')
                if copied.execute('SELECT status FROM jobs').fetchall() != [('completed',)]:
                    raise RuntimeError('시험 전체 아카이브의 DB 상태 확인 실패')
            finally:
                copied.close()
        print('가짜 경로와 실제 백업 아카이브 함수의 SQLite 복사본 무결성 확인', flush=True)
    finally:
        archive_guard.release()
    events.clear()
    guard.process.kill()
    guard.process.wait(timeout=30)
    try:
        adapter.run()
    except sequence.SequenceError as exc:
        if not isinstance(exc.__cause__, RuntimeError) or 'DB 검사 전' not in str(exc.__cause__):
            raise
    else:
        raise SystemExit('별도 시험 잠금 후보 종료 후 백업이 허용됐습니다.')
    if events:
        raise SystemExit('별도 시험 잠금 후보 종료 후 백업이 생성됐습니다.')
    if not archive.is_file():
        raise SystemExit('이미 생성된 시험 DB 아카이브가 보존되지 않았습니다.')
    print('별도 시험 잠금 후보 종료 후 DB 검사·백업 전 중단과 시험 아카이브 보존 확인', flush=True)
finally:
    guard.release()
print('가짜 경로만 아카이브했습니다. gate·유지보수·직접 파일 쓰기 차단과 운영 상태는 모의이며 운영 서비스와 데이터는 변경하지 않았습니다.', flush=True)
PY
systemctl stop "${unit##*/}"
rm -- "$unit"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture"
