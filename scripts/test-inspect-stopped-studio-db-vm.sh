#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-studio-db-observe.XXXXXXXX)
chmod 0755 "$fixture"
unit=/run/systemd/system/bc250-studio-db-fixture.service
[[ ! -e $unit && ! -L $unit && ! -e /etc/systemd/system/${unit##*/} \
  && $(systemctl show "${unit##*/}" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $fixture $unit" >&2' ERR
for name in inspect-stopped-studio-db.py backup-archive.sh check-service-cgroup.py; do
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
systemctl start "${unit##*/}"
python3 - "$fixture" <<'PY'
import hashlib
import importlib.util
import sqlite3
import subprocess
import sys
from pathlib import Path

fixture = Path(sys.argv[1])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fixture_db', fixture / 'inspect-stopped-studio-db.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
db = fixture / 'studio.sqlite3'
connection = sqlite3.connect(db)
connection.execute('PRAGMA journal_mode=WAL')
connection.execute('CREATE TABLE jobs (status TEXT)')
connection.execute('CREATE TABLE system_state (key TEXT, value TEXT)')
connection.execute("INSERT INTO jobs VALUES ('completed')")
connection.execute("INSERT INTO system_state VALUES ('transition', '{}')")
connection.commit()
def stopped():
    result = subprocess.run(['/usr/bin/bash', '-c', 'source "$1"; shift; bc250_require_stopped "$@"',
                             'fixture', str(fixture / 'backup-archive.sh'), 'bc250-studio-db-fixture.service'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return result.returncode == 0
try:
    module.inspect(db, check_stopped=stopped)
except ValueError as exc:
    if '정지' not in str(exc):
        raise
else:
    raise SystemExit('실행 중인 시험 Studio가 허용됐습니다.')
subprocess.run(['/usr/bin/systemctl', 'stop', 'bc250-studio-db-fixture.service'], check=True)
def hashes():
    return {p.name: hashlib.sha256(p.read_bytes()).digest() for p in
            (db, Path(str(db) + '-wal'), Path(str(db) + '-shm')) if p.exists()}
before = hashes()
if module.inspect(db, check_stopped=stopped) is not True or hashes() != before:
    raise SystemExit('시험 정지 상태 검사 또는 원본 보존에 실패했습니다.')
print('정지된 시험 Studio의 DB 사본 검사와 원본 보존 확인', flush=True)
connection.execute("INSERT INTO jobs VALUES ('queued')")
connection.commit()
before = hashes()
try:
    module.inspect(db, check_stopped=stopped)
except ValueError as exc:
    if '완료되지 않은' not in str(exc):
        raise
else:
    raise SystemExit('WAL에 기록된 시험 대기 작업이 허용됐습니다.')
if hashes() != before:
    raise SystemExit('시험 DB 또는 WAL 원본이 변경됐습니다.')
print('WAL의 시험 대기 작업 거절과 원본 보존 확인', flush=True)
print('실행 중인 시험 Studio 거절 확인', flush=True)
connection.close()
print('다른 직접 DB 쓰기 차단은 이 시험의 범위 밖입니다.', flush=True)
PY
systemctl stop "${unit##*/}"
rm -- "$unit"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture"
