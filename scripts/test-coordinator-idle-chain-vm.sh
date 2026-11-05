#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && ( $# == 1 || ( $# == 2 && ( $2 == adapter || $2 == initial ) ) ) ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-idle-chain.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-idle-chain.XXXXXXXX)
backup=$(mktemp -d /var/backups/bc250-model-migration.XXXXXXXX)
chmod 0755 "$fixture"
wiki=bc250-idle-chain-wiki.service
llama=bc250-idle-chain-llama.service
studio=bc250-idle-chain-studio.service
marker=/var/lib/bc250-idle-chain-wiki
for path in "/etc/systemd/system/$wiki" "/etc/systemd/system/$wiki.d" "/etc/systemd/system/$llama" "/etc/systemd/system/$studio" "$marker"; do [[ ! -e $path && ! -L $path ]] || exit 1; done
for unit in "$wiki" "$llama" "$studio"; do [[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1; done
[[ -z $(ss -H -ltn 'sport = :18885') ]] || exit 1
trap 'echo "시험 중단. 시험 unit 및 기록 보존: $fixture $records $backup /etc/systemd/system/$wiki /etc/systemd/system/$llama $marker" >&2' ERR
for name in coordinated-migration.py migration-journal.py wiki-condition-fence.py wiki-maintenance-fence.py read-systemd-conditions.py verify-wiki-condition.py check-service-cgroup.py backup-archive.sh observe-direct-llm.py observe-llama-listener.py local-idle-composite.py initial-local-idle.py legacy-backup-adapter.py legacy-backup-sequence.py inspect-stopped-studio-db.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$fixture/$name"
done
cat > "$fixture/llama.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import sys
busy = Path(sys.argv[1]) / 'busy'
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/slots': self.send_error(404); return
        data = b'[{"is_processing":true}]' if busy.exists() else b'[{"is_processing":false}]'
        self.send_response(200); self.end_headers(); self.wfile.write(data)
    def log_message(self, *_): pass
HTTPServer(('127.0.0.1', 18885), Handler).serve_forever()
PY
cat > "/etc/systemd/system/$wiki" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
cat > "/etc/systemd/system/$llama" <<EOF
[Service]
ExecStart=/usr/bin/python3 $fixture/llama.py $fixture
KillMode=control-group
EOF
cat > "/etc/systemd/system/$studio" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
restorecon -RF "$fixture" "$records" "$backup"
restorecon -F "/etc/systemd/system/$wiki" "/etc/systemd/system/$llama" "/etc/systemd/system/$studio"
systemctl daemon-reload
systemctl start "$wiki" "$llama" "$studio"
python3 - "$fixture" "$records" "$backup" "$wiki" "$llama" "$marker" "$studio" "${2:-simple}" <<'PY'
import importlib.util
import json
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

fixture, records, backup = map(Path, sys.argv[1:4])
wiki_unit, llama_unit, marker, studio_unit, mode = sys.argv[4], sys.argv[5], Path(sys.argv[6]), sys.argv[7], sys.argv[8]
sys.dont_write_bytecode = True
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, fixture / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
coordinator = load('chain_coordinator', 'coordinated-migration.py')
journal_module = load('chain_journal', 'migration-journal.py')
wiki_module = load('chain_wiki', 'wiki-condition-fence.py')
observe = load('chain_observe', 'observe-direct-llm.py')
composite = load('chain_composite', 'local-idle-composite.py')
initial_idle = load('chain_initial_idle', 'initial-local-idle.py')
backup_module = load('chain_backup', 'legacy-backup-adapter.py')
backup_sequence = load('chain_backup_sequence', 'legacy-backup-sequence.py')
backup_db = load('chain_stopped_db', 'inspect-stopped-studio-db.py')
backup_module.UNITS = (studio_unit,)
backup_module.STUDIO_DATABASE = fixture / 'studio.sqlite3'
with sqlite3.connect(backup_module.STUDIO_DATABASE) as db:
    db.execute('CREATE TABLE jobs (status TEXT)')
    db.execute('CREATE TABLE system_state (key TEXT, value TEXT)')
wiki_module.UNIT, wiki_module.PERSISTENT_MARKER = wiki_unit, marker
observe.WIKI, observe.LLAMA = wiki_unit, llama_unit
observe.SLOTS_URL = 'http://127.0.0.1:18885/slots'
for attempt in range(40):
    try:
        with urllib.request.urlopen(observe.SLOTS_URL, timeout=2): pass
        break
    except urllib.error.URLError:
        if attempt == 39: raise
        time.sleep(.2)

def setup(name, lose_during_db=False):
    folder = records / name
    folder.mkdir(mode=0o700)
    wiki_dir = folder / 'wiki'
    wiki_dir.mkdir(mode=0o700)
    wiki = wiki_module.WikiConditionFence(fixture, wiki_dir, persistent=True)
    journal = journal_module.MigrationJournal(folder)
    journal.release('a' * 40, 'b' * 64)
    calls = []
    callers_fenced = [True]
    if mode == 'initial':
        idle = initial_idle.InitialLocalIdle(fixture, check_wiki=wiki.check,
            check_other_callers=lambda: callers_fenced[0], check_gpu=lambda: True,
            llama_key=lambda: '')
        idle.observer.WIKI, idle.observer.LLAMA = wiki_unit, llama_unit
        idle.observer.SLOTS_URL = observe.SLOTS_URL
        listener_identity = idle.listener.listener_identity
        idle.listener.listener_identity = lambda: listener_identity(18885, llama_unit)
    else:
        idle = composite.LocalIdleComposite(check_wiki_fence=wiki.check,
            check_other_callers_fenced=lambda: callers_fenced[0],
            observe_llama=lambda: observe.observe(fixture / 'backup-archive.sh'),
            check_gpu_idle=lambda: True)
    def make_backup():
        idle()
        calls.append('backup-created')
        return backup
    if mode == 'adapter':
        adapter = backup_module.LegacyBackupAdapter.__new__(backup_module.LegacyBackupAdapter)
        adapter.source, adapter.sequence, adapter.studio_db = fixture, backup_sequence, backup_db
        adapter.llama_connections = SimpleNamespace(check_host_llama=lambda: True)
        if lose_during_db:
            def inspect_then_lose(*args, **kwargs):
                result = backup_db.inspect(*args, **kwargs)
                callers_fenced[0] = False
                return result
            adapter.studio_db = SimpleNamespace(inspect=inspect_then_lose)
        adapter.maintenance = lambda: True
        adapter.check_local_idle = idle
        adapter.check_database_fence = lambda: True  # fixture only
        state = {'paused': True, 'active_requests': 0, 'waiting_requests': 0}
        def capture_pause():
            idle()
            return state
        adapter.capture_pause = capture_pause
        adapter.gate_status = lambda: state
        adapter.stop = lambda: subprocess.run(['/usr/bin/systemctl', 'stop', studio_unit], check=True)
        adapter.create_backup = lambda: calls.append('backup-created') or backup
        adapter.verify_backup = lambda _: None
        backup_run = adapter.run
    else:
        backup_run = make_backup
    def install(_): calls.append('install'); return True
    def transition(*, mode): calls.append('caddy-' + mode)
    runner = coordinator.CoordinatedMigration(record=journal, preflight=lambda: True,
        transition=transition, transition_args={}, backup_adapter=SimpleNamespace(run=backup_run),
        install=install, startup=SimpleNamespace(start=lambda: None, finish=lambda: None),
        verify_new=lambda: True, verify_restored=lambda: True, wiki_fence=wiki)
    return runner, wiki, journal, calls, folder

(fixture / 'busy').touch()
runner, wiki, journal, calls, folder = setup('busy')
try:
    try: runner.prepare_and_start()
    except coordinator.MigrationError as error:
        cause = error.__cause__
        if mode == 'adapter' and isinstance(cause, backup_sequence.SequenceError):
            cause = cause.__cause__
        if not isinstance(cause, ValueError) or '진행 중인 llama 슬롯' not in str(cause):
            raise
    else: raise RuntimeError('사용 중인 시험 llama를 거절하지 못했습니다.')
    wiki.check()
    rows = [json.loads(line)['event'] for line in (folder / 'migration-events.jsonl').read_text().splitlines()]
    if ('legacy_backup:begin' not in rows or 'backup-created' in calls or 'install' in calls
            or 'legacy_backup:confirmed' in rows):
        raise RuntimeError('사용 중인데 백업 또는 설치가 진행됐습니다.')
    print('시험 llama 작업 중 Wiki 차단 유지와 백업 생성 전 중단 확인', flush=True)
    wiki.release(can_release=lambda: True)
finally: journal.close()
(fixture / 'busy').unlink()
runner, wiki, journal, calls, folder = setup('idle')
try:
    runner.prepare_and_start()
    if runner.phase != 'await_client' or calls != ['caddy-enter', 'backup-created', 'install']:
        raise RuntimeError('시험 유휴 순서가 올바르지 않습니다.')
    wiki.check()
    runner.finish_after_client_restart()
    if runner.phase != 'complete' or calls[-1] != 'caddy-restore':
        raise RuntimeError('시험 종료 순서가 올바르지 않습니다.')
    print('시험 Wiki 차단 후 llama 유휴 확인·백업 연결 및 기존 Wiki 상태 복원 확인', flush=True)
    if mode == 'initial':
        print('시험 최초 유휴 검사 후보와 실제 시험 llama 관찰 연결 확인', flush=True)
    if mode == 'adapter':
        print('시험 Studio 정지와 DB 검사까지 실제 백업 어댑터 연결 확인', flush=True)
finally: journal.close()
if mode == 'initial':
    subprocess.run(['/usr/bin/systemctl', 'stop', wiki_unit], check=True)
    idle = initial_idle.InitialLocalIdle(fixture, check_wiki=lambda: True,
        check_other_callers=lambda: True, check_gpu=lambda: True, llama_key=lambda: '')
    idle.observer.WIKI, idle.observer.LLAMA = wiki_unit, llama_unit
    idle.observer.SLOTS_URL = observe.SLOTS_URL
    identity = idle.listener.listener_identity
    idle.listener.listener_identity = lambda: identity(18885, llama_unit)
    original_observe = idle.observer.observe
    def observe_then_restart(*args, **kwargs):
        result = original_observe(*args, **kwargs)
        subprocess.run(['/usr/bin/systemctl', 'restart', llama_unit], check=True, timeout=60)
        for _ in range(60):
            try:
                identity(18885, llama_unit)
                break
            except (OSError, ValueError):
                time.sleep(.5)
        else:
            raise RuntimeError('재시작한 시험 llama 수신 대기 시간 초과')
        return result
    idle.observer.observe = observe_then_restart
    try:
        idle()
    except ValueError as error:
        if '관찰 중 서비스 또는 수신 소켓이 변경' not in str(error):
            raise
        print('슬롯 관찰 중 시험 llama 재시작 시 유휴 검사 거절 확인', flush=True)
    else:
        raise RuntimeError('시험 llama 재시작을 거절하지 못했습니다.')
if mode == 'adapter':
    subprocess.run(['/usr/bin/systemctl', 'start', studio_unit], check=True)
    runner, wiki, journal, calls, folder = setup('fence-loss', lose_during_db=True)
    try:
        try:
            runner.prepare_and_start()
        except coordinator.MigrationError as error:
            cause = error.__cause__
            if not isinstance(cause, backup_sequence.SequenceError): raise
        else:
            raise RuntimeError('DB 검사 중 차단 상실을 거절하지 못했습니다.')
        wiki.check()
        rows = [json.loads(line)['event'] for line in (folder / 'migration-events.jsonl').read_text().splitlines()]
        if 'backup-created' in calls or 'install' in calls or 'legacy_backup:confirmed' in rows:
            raise RuntimeError('차단 상실 후 백업 또는 설치가 진행됐습니다.')
        print('시험 DB 검사 중 모의 직접 호출 차단 상실 시 백업 전 중단 확인', flush=True)
        wiki.release(can_release=lambda: True)
    finally:
        journal.close()
print('Caddy·직접 호출자 지속 차단·llama TCP 연결 검사·GPU·백업 파일·설치·Client는 모의입니다.', flush=True)
PY
systemctl stop "$wiki" "$llama" "$studio"
rm -- "/etc/systemd/system/$wiki" "/etc/systemd/system/$llama" "/etc/systemd/system/$studio"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture $records $backup"
