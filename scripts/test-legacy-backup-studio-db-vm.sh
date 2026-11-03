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
for name in legacy-backup-adapter.py legacy-backup-sequence.py inspect-stopped-studio-db.py \
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
db = fixture / 'studio.sqlite3'
with sqlite3.connect(db) as connection:
    connection.execute('CREATE TABLE jobs (status TEXT)')
    connection.execute('CREATE TABLE system_state (key TEXT, value TEXT)')
    connection.execute("INSERT INTO jobs VALUES ('queued')")
backup.UNITS = ('bc250-legacy-db-fixture.service',)
backup.STUDIO_DATABASE = db
adapter = backup.LegacyBackupAdapter.__new__(backup.LegacyBackupAdapter)
adapter.source = fixture
adapter.sequence = sequence
adapter.studio_db = database
adapter.llama_connections = SimpleNamespace(check_host_llama=lambda: True)
adapter.maintenance = lambda: True
adapter.check_local_idle = lambda: True
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
if adapter.run() != fixture / 'fake-backup' or events != ['backup', 'verified']:
    raise SystemExit('유휴 시험 Studio의 백업 연결에 실패했습니다.')
print('정지된 시험 Studio DB 검사 후 백업 연결 확인', flush=True)
print('gate·유지보수·백업 파일 생성은 모의이며 실제 서비스와 데이터는 변경하지 않았습니다.', flush=True)
PY
systemctl stop "${unit##*/}"
rm -- "$unit"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture"
