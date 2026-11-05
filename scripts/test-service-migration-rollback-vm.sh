#!/usr/bin/env bash
# Linked failure/recovery test against disposable services and files only.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/migrate-legacy-gate.py \
  && -f $1/deploy/model-control/backup-archive.sh ]] || exit 1
source_dir=$1
original=/var/tmp/bc250-backup-archive-test.jHO1rD8O
[[ -f $original/source/etc/bc250-ai-studio.env && -f $original/Caddyfile.original ]] || {
  echo '기존 시험용 백업 자료가 없습니다.' >&2; exit 1;
}
units=(bc250-linked-studio-fixture-v2.service bc250-linked-gate-fixture-v2.service bc250-linked-client-fixture-v2.service)
worker_unit=bc250-linked-worker-fixture-v2.service
worker_socket=bc250-linked-worker-fixture-v2.socket
for unit in "${units[@]}"; do
  [[ ! -e /run/systemd/system/$unit && ! -e /etc/systemd/system/$unit ]] || exit 1
done
[[ -z $(ss -H -ltn 'sport = :18883') ]] || { echo '시험 포트가 사용 중입니다.' >&2; exit 1; }
if [[ -n ${BC250_FIXTURE_CADDY_BASE:-} ]]; then
  [[ ! -e /run/systemd/system/$worker_unit && ! -e /etc/systemd/system/$worker_unit \
    && ! -e /run/systemd/system/$worker_socket && ! -e /etc/systemd/system/$worker_socket \
    && -z $(ss -H -ltn 'sport = :18884') ]] || exit 1
fi
fixture=$(mktemp -d /var/backups/bc250-linked-migration.XXXXXXXX)
envdir=$(mktemp -d /etc/bc250-linked-fixture.XXXXXXXX)
stateparent=$(mktemp -d /var/lib/bc250-linked-fixture.XXXXXXXX)
adapterdir=$(mktemp -d /opt/bc250-backup-adapter.XXXXXXXX)
chmod 0755 "$adapterdir"
for name in backup-stopped.sh backup-archive.sh check-service-cgroup.py verify-backup.py \
  create-maintenance-caddy.py migrate-legacy-gate.py capture-caddy.py maintenance-probe.py \
  legacy-backup-sequence.py legacy-backup-adapter.py restore-legacy-files.py \
  inspect-stopped-studio-db.py observe-llama-connections.py \
  preserve-new-adapter.py preserve-new-stopped.sh preserve-new-archive.sh \
  check-preserved-switch-state.py check-new-switch-state.py wiki-condition-fence.py \
  wiki-maintenance-fence.py read-systemd-conditions.py verify-wiki-condition.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$adapterdir/$name"
done
restorecon -RF "$adapterdir"
if [[ ${BC250_FIXTURE_REAL_WIKI:-} == 1 ]]; then
  wiki_unit=bc250-manual-linked-wiki-fixture.service
  wiki_file=/etc/systemd/system/$wiki_unit
  wiki_dropin=/etc/systemd/system/$wiki_unit.d
  wiki_marker=/var/lib/bc250-manual-linked-wiki-fixture
  for path in "$wiki_file" "$wiki_dropin" "$wiki_marker"; do [[ ! -e $path && ! -L $path ]] || exit 1; done
  [[ $(systemctl show "$wiki_unit" -p LoadState --value) == not-found ]] || exit 1
  cat > "$wiki_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
  restorecon -F "$wiki_file"
fi
trap 'echo "시험 중단. 시험 서비스와 기록을 보존합니다: $fixture $envdir $stateparent $adapterdir" >&2' ERR
cp -a "$original/source" "$fixture/live"
cp -a "$original/Caddyfile.original" "$fixture/Caddyfile.original"
cp -a "$fixture/live/etc/bc250-llm-gate.env" "$envdir/gate.env"
cp -a "$fixture/live/etc/bc250-llm-client.env" "$envdir/client.env"
for unit in "${units[0]}" "${units[2]}"; do
  cat > "/run/systemd/system/$unit" <<EOF
[Service]
EnvironmentFile=$envdir/client.env
ExecStart=/usr/bin/sleep 600
KillMode=control-group
EOF
done
cat > "/run/systemd/system/${units[1]}" <<EOF
[Service]
EnvironmentFile=$envdir/gate.env
ExecStart=/opt/bc250-model-control/.venv/bin/python -I -m uvicorn app.gate:create_gate_app --factory --host 127.0.0.1 --port 18883 --workers 1 --no-access-log
KillMode=control-group
EOF
if [[ -n ${BC250_FIXTURE_CADDY_BASE:-} ]]; then
  cat > "/run/systemd/system/$worker_unit" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep 600
KillMode=control-group
EOF
  cat > "/run/systemd/system/$worker_socket" <<'EOF'
[Socket]
ListenStream=127.0.0.1:18884
Accept=no
EOF
  restorecon -F "/run/systemd/system/$worker_unit" "/run/systemd/system/$worker_socket"
fi
restorecon -RF "$fixture" "$envdir" "$stateparent" "/run/systemd/system/${units[0]}" \
  "/run/systemd/system/${units[1]}" "/run/systemd/system/${units[2]}"
systemctl daemon-reload
if [[ ${BC250_FIXTURE_REAL_WIKI:-} == 1 ]]; then systemctl start "$wiki_unit"; fi
python3 - "$source_dir" "$fixture" "$envdir" "$stateparent" "$adapterdir" "${units[@]}" <<'PY'
import importlib.util
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

source, fixture, envdir, stateparent, adapterdir = map(Path, sys.argv[1:6])
studio, gate, client = sys.argv[6:]
spec = importlib.util.spec_from_file_location('migration', source / 'deploy/model-control/migrate-legacy-gate.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
spec = importlib.util.spec_from_file_location('sequence', source / 'deploy/model-control/legacy-backup-sequence.py')
sequence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sequence)
spec = importlib.util.spec_from_file_location('rollback', source / 'deploy/model-control/legacy-rollback-sequence.py')
rollback = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rollback)
spec = importlib.util.spec_from_file_location('restore_files', adapterdir / 'restore-legacy-files.py')
restore_files = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore_files)
migration.URL = 'http://127.0.0.1:18883/control'
old = 'fixture-old-gate-key-0123456789abcdef'
new = 'fixture-new-gate-key-0123456789abcdef'
live = fixture / 'live'
snapshot = live / 'var/lib/bc250-model-control/legacy-pause.json'
snapshot.unlink()

def ctl(*args):
    subprocess.run(['systemctl', *args], check=True, timeout=90)

def env(path, lines):
    path.write_text('\n'.join(lines) + '\n')
    path.chmod(0o600)
    subprocess.run(['restorecon', '-F', str(path)], check=True)

def client_key(key):
    pid = int(subprocess.check_output(['systemctl', 'show', client, '-p', 'MainPID', '--value']))
    assert b'LLM_GATE_API_KEY=' + key.encode() in Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')

def ready(key):
    for _ in range(36):
        try:
            return migration.request(key, 'GET')
        except OSError:
            time.sleep(2)
    raise RuntimeError('시험 gate 시작 시간 초과')

def stopped():
    subprocess.run(['bash', '-c', 'source "$1"; shift; bc250_require_stopped "$@"',
                    'fixture', str(source / 'deploy/model-control/backup-archive.sh'),
                    studio, gate, client], check=True)

env(envdir / 'gate.env', ['GATE_API_KEY=' + old])
env(envdir / 'client.env', ['LLM_GATE_API_KEY=' + old])
ctl('start', gate, studio, client)
ready(old)
client_key(old)
migration.request(old, 'PUT', {'paused': True})
def create_backup():
    for name in ('gate', 'client'):
        subprocess.run(['cp', '-a', str(envdir / (name + '.env')),
                        str(live / ('etc/bc250-llm-' + name + '.env'))], check=True)
    result = fixture / 'backup'
    result.mkdir(mode=0o700)
    subprocess.run(['bash', '-c', 'source "$1"; bc250_backup_archive "$2" "$3" "$4"',
                    'fixture', str(source / 'deploy/model-control/backup-archive.sh'),
                    str(live), str(result), str(fixture / 'Caddyfile.original')], check=True)
    return result

def verify_backup(path):
    subprocess.run(['python3', str(source / 'deploy/model-control/verify-backup.py'), str(path)], check=True)

# The production adapter uses real gate and systemd operations.  This fixture
# redirects paths/units and supplies simulated ingress, local idle and archive
# callbacks; the production Caddy and backup wrapper are not run here.
spec = importlib.util.spec_from_file_location('backup_adapter', adapterdir / 'legacy-backup-adapter.py')
adapter_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter_module)
adapter_module.UNITS = (studio, client, gate)
adapter_module.OLD_ENV = envdir / 'gate.env'
adapter_module.PAUSE_RECORD = snapshot
adapter_module.STUDIO_DATABASE = live / 'opt/ai-studio-data/database/studio.sqlite3'
adapter_module.STUDIO_DATABASE.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(adapter_module.STUDIO_DATABASE) as db:
    db.execute('CREATE TABLE jobs (status TEXT)')
    db.execute('CREATE TABLE system_state (key TEXT, value TEXT)')
adapter = adapter_module.LegacyBackupAdapter(adapterdir, fixture, check_local_idle=lambda: True, check_database_fence=lambda: True)
adapter.migration.URL = 'http://127.0.0.1:18883/control'
caddy_base = os.environ.get('BC250_FIXTURE_CADDY_BASE')
if caddy_base:
    if not re.fullmatch(r'http://127\.0\.0\.1:[0-9]{2,5}', caddy_base):
        raise SystemExit('시험 Caddy 주소가 올바르지 않습니다.')
    check_maintenance = lambda: adapter.probe.probe(caddy_base)
else:
    check_maintenance = lambda: True
adapter.maintenance = check_maintenance
adapter.create_backup = create_backup
adapter.verify_backup = verify_backup
backup = adapter.run()
print('운영 어댑터의 시험 gate 인증·pause·정지 순서와 cgroup 검사 확인 (백업 경로는 모의)', flush=True)
print('연결 로직의 pause·drain·세 서비스 정지·백업 검증 확인' +
      ('' if caddy_base else ' (유지보수는 모의)'), flush=True)
print('세 시험 서비스 정지 후 기존 pause와 코드·데이터 백업 확인', flush=True)

# create_state normally checks the operational unit names; check the disposable
# fixture units instead and keep the production operation otherwise unchanged.
migration.verify_stopped = lambda unit: stopped()
gate_dir = stateparent / 'owned-gate'
migration.create_state(snapshot, gate_dir)
subprocess.run(['restorecon', '-RF', str(gate_dir)], check=True)
env(envdir / 'gate.env', ['GATE_API_KEY=' + new, 'GATE_OWNED_CONTROL=true',
    'GATE_STATE_PATH=' + str(gate_dir / 'holds.json'),
    'GATE_STUDIO_KEY=fixture-studio-key-0123456789abcdef',
    'GATE_SWITCH_KEY=fixture-switch-key-0123456789abcdef'])
env(envdir / 'client.env', ['LLM_GATE_API_KEY=' + new])
ctl('start', gate, studio, client)
state = ready(new)
assert state['paused'] and {'startup', 'legacy'}.issubset(state['holds'])
client_key(new)
print('새 시험 gate의 보류와 Client 프로세스 키 확인', flush=True)

# Simulated failure after new services started. Preserve new gate state first.
(live / 'opt/bc250-ai-studio/backend/main.py').write_text('failed migration\n')
(live / 'opt/ai-studio-data/data.db').write_text('changed data\n')
def preserve_new():
    if caddy_base:
        new_state = live / 'var/lib/bc250-model-control'
        gate_state = live / 'var/lib/bc250-llm-gate'
        settings = live / 'etc/bc250-model-control'
        if any(path.exists() for path in (new_state / 'switch.json', new_state / 'operations.sqlite3',
                                          gate_state, settings)):
            raise RuntimeError('시험 신규 상태 경로가 이미 있습니다.')
        (new_state / 'switch.json').write_text('{}\n')
        with sqlite3.connect(new_state / 'operations.sqlite3') as db:
            db.execute('CREATE TABLE switch_operations (state TEXT NOT NULL)')
        shutil.copytree(gate_dir, gate_state, copy_function=shutil.copy2)
        settings.mkdir(mode=0o700)
        (settings / 'worker.env').write_text('MODEL_CONTROL_SWITCH_ENABLED=false\n')
        # Match the production GNU mktemp naming contract; Python mkdtemp may include underscores.
        evidence = Path(subprocess.check_output(
            ['mktemp', '-d', '/var/backups/bc250-model-postfailure.XXXXXXXX'], text=True).strip())
        subprocess.run(['bash', '-c', 'source "$1"; bc250_preserve_new_archive "$2" "$3"',
                        'fixture', str(adapterdir / 'preserve-new-archive.sh'), str(live), str(evidence)],
                       check=True)
        names = []
        for unit in (*preserve_module.UNITS, preserve_module.SOCKET, 'llama-server.service'):
            path = evidence / (unit + '.status')
            with path.open('wb') as file:
                subprocess.run(['systemctl', 'show', '--all', unit, '-p', 'LoadState', '-p', 'ActiveState',
                                '-p', 'SubState', '-p', 'Job', '-p', 'MainPID', '-p', 'Result',
                                '-p', 'ControlGroup'], stdout=file, check=True)
                file.flush()
                os.fsync(file.fileno())
            names.append(path.name)
        log = evidence / 'systemd-journal.log'
        with log.open('wb') as file:
            subprocess.run(['journalctl', '--no-pager', '--boot', '--output=short-iso',
                            '-u', studio, '-u', gate, '-u', client,
                            '-u', 'bc250-linked-worker-fixture-v2.service'], stdout=file, check=True)
            file.flush()
            os.fsync(file.fileno())
        names.append(log.name)
        manifest = evidence / 'SYSTEMD-SHA256SUMS'
        with manifest.open('w', encoding='ascii') as file:
            for name in sorted(names):
                with (evidence / name).open('rb') as item:
                    digest = hashlib.file_digest(item, 'sha256').hexdigest()
                file.write(f'{digest}  {name}\n')
            file.flush()
            os.fsync(file.fileno())
        directory = os.open(evidence, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return evidence
    evidence = fixture / 'new-state-evidence'
    evidence.mkdir(mode=0o700)
    shutil.copytree(gate_dir, evidence / 'gate', copy_function=shutil.copy2)
    shutil.copy2(live / 'opt/ai-studio-data/data.db', evidence / 'changed-data.db')
    return evidence

def recovery_safe(evidence):
    if caddy_base:
        return new_adapter.recovery_safe(evidence, check_model=lambda: True)
    # This fixture does not model a switch journal or in-flight systemd jobs.
    return bool(json.loads((evidence / 'gate/holds.json').read_text())['holds'])

def stage_backup():
    output = subprocess.check_output(['bash', str(source / 'deploy/model-control/restore-backup-to-stage.sh'),
                                      str(backup)], text=True)
    return next(Path(line.split(': ', 1)[1]) for line in output.splitlines()
                if line.startswith('복원 확인 경로: '))

def restore_legacy(stage):
    displaced = fixture / 'displaced-files'
    displaced.mkdir(mode=0o700)
    restore_files.restore(stage / 'files', live, displaced)
    for relative in ('opt/bc250-ai-studio/backend/main.py', 'opt/ai-studio-data/data.db'):
        assert (live / relative).read_bytes() == (stage / 'files' / relative).read_bytes()
    for name in ('gate', 'client'):
        relative = 'etc/bc250-llm-' + name + '.env'
        subprocess.run(['cp', '-a', str(stage / 'files' / relative), str(envdir / (name + '.env'))], check=True)
        subprocess.run(['restorecon', '-F', str(envdir / (name + '.env'))], check=True)
    return stage

def start_gate():
    ctl('start', gate)
    ready(old)

def restore_pause():
    assert migration.restore_pause(old, snapshot)['paused'] is True

if caddy_base:
    preserve_spec = importlib.util.spec_from_file_location('preserve_adapter', adapterdir / 'preserve-new-adapter.py')
    preserve_module = importlib.util.module_from_spec(preserve_spec)
    preserve_spec.loader.exec_module(preserve_module)
    preserve_module.SOCKET = 'bc250-linked-worker-fixture-v2.socket'
    preserve_module.UNITS = ('bc250-linked-worker-fixture-v2.service', client, studio, gate)
    preserve_module.SYSTEMD_EVIDENCE = frozenset(
        {unit + '.status' for unit in (*preserve_module.UNITS, preserve_module.SOCKET, 'llama-server.service')}
        | {'systemd-journal.log'})
    new_adapter = preserve_module.PreserveNewAdapter(
        adapterdir, check_maintenance=check_maintenance,
        inspect_live=lambda: ready(new)['paused'], check_local_idle=lambda: True)
    ctl('start', preserve_module.SOCKET)
    stop_new = new_adapter.stop
    require_stopped = new_adapter.require_stopped
else:
    stop_new = lambda: ctl('stop', studio, client, gate)
    require_stopped = stopped
if os.environ.get('BC250_FIXTURE_MANUAL_ROLLBACK') == '1':
    if not caddy_base:
        raise RuntimeError('시험 Caddy가 필요합니다.')
    spec = importlib.util.spec_from_file_location('manual_rollback', source / 'deploy/model-control/legacy-rollback-manual.py')
    manual = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manual)
    spec = importlib.util.spec_from_file_location('journal', source / 'deploy/model-control/migration-journal.py')
    journal_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(journal_module)
    record_dir = Path(tempfile.mkdtemp(prefix='bc250-manual-linked-record.', dir='/var/backups'))
    journal = journal_module.MigrationJournal(record_dir)
    class FixtureWiki:
        blocked = True
        def check(self):
            return self.blocked
        def release(self, *, can_release):
            if not can_release():
                raise RuntimeError('시험 복구 확인 실패')
            self.blocked = False
            return True
    real_wiki = os.environ.get('BC250_FIXTURE_REAL_WIKI') == '1'
    if real_wiki:
        wiki_folder = record_dir / 'wiki'
        wiki_folder.mkdir(mode=0o700)
        spec = importlib.util.spec_from_file_location('linked_wiki', adapterdir / 'wiki-condition-fence.py')
        wiki_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(wiki_module)
        wiki_module.UNIT = 'bc250-manual-linked-wiki-fixture.service'
        wiki_module.PERSISTENT_MARKER = Path('/var/lib/bc250-manual-linked-wiki-fixture')
        wiki = wiki_module.WikiConditionFence(adapterdir, wiki_folder, persistent=True)
        wiki.acquire()
    else:
        wiki = FixtureWiki()
    def client_is_stopped():
        return subprocess.check_output(['systemctl', 'show', client, '-p', 'ActiveState', '--value'], text=True).strip() == 'inactive'
    def verify_legacy():
        client_key(old)
        return bool(ready(old)['paused'])
    runner = manual.ManualRollback(record=journal, wiki_fence=wiki,
        check_maintenance=check_maintenance, inspect_new=lambda: ready(new)['paused'],
        stop_new=stop_new, require_stopped=require_stopped, preserve_new=preserve_new,
        recovery_safe=recovery_safe, verify_backup=lambda: verify_backup(backup),
        stage_backup=stage_backup, restore_legacy=restore_legacy, start_legacy_gate=start_gate,
        restore_pause=restore_pause, start_legacy_studio=lambda: ctl('start', studio),
        client_stopped=client_is_stopped, verify_legacy=verify_legacy,
        restore_ingress=lambda: check_maintenance())
    try:
        runner.begin()
        if runner.phase != 'await_client' or not client_is_stopped() or wiki.check() is not True or not check_maintenance():
            raise RuntimeError('시험 수동 Client 대기 또는 유지보수 확인 실패')
        print('기존 시험 gate·Studio 복원 후 Client 정지와 유지보수 유지 확인', flush=True)
        ctl('start', client)  # Simulate the operator's manual restart.
        runner.finish_after_client_restart()
        if runner.phase != 'complete' or not check_maintenance():
            raise RuntimeError('시험 수동 재시작 후 복구 확인 실패')
        rows = [json.loads(line) for line in (record_dir / 'migration-events.jsonl').read_text().splitlines()]
        evidence = next(Path(row['path']) for row in rows if row['event'] == 'rollback_evidence:path')
        print('시험 Client 수동 재시작 후 기존 키·pause와 롤백 기록 확인', flush=True)
        if real_wiki:
            status = subprocess.check_output(['systemctl', 'show', wiki_module.UNIT, '-p', 'ActiveState', '--value'], text=True).strip()
            if status != 'active':
                raise RuntimeError('시험 Wiki의 이전 실행 상태가 복원되지 않았습니다.')
            print('실제 시험 Wiki 영구 차단 유지 및 기존 실행 상태 복원 확인', flush=True)
        print(('모델 health·로컬 유휴와 롤백 후보 내부의 유지보수 해제는 모의; 기록:' if real_wiki else
               'Wiki 차단·모델 health·로컬 유휴와 유지보수 해제는 모의; 기록:'), record_dir, flush=True)
    finally:
        journal.close()
else:
    evidence = rollback.rollback_legacy(
        check_maintenance=check_maintenance,
        inspect_new=lambda: ready(new)['paused'],
        stop_new=stop_new, require_stopped=require_stopped,
        preserve_new=preserve_new, recovery_safe=recovery_safe,
        verify_backup=lambda: verify_backup(backup), stage_backup=stage_backup,
        restore_legacy=restore_legacy, start_legacy_gate=start_gate,
        restore_pause=restore_pause, start_legacy_services=lambda: ctl('start', studio, client),
        verify_legacy=lambda: client_key(old))
if caddy_base:
    with tarfile.open(evidence / 'new-state.tar') as archive:
        assert archive.extractfile('opt/ai-studio-data/data.db').read() == b'changed data\n'
    print('시험 gate hold·journal·변경 데이터 보존 및 복구 전 상태 검증 확인', flush=True)
else:
    assert (evidence / 'changed-data.db').read_text() == 'changed data\n'
assert (fixture / 'displaced-files/displaced/opt/ai-studio-data/data.db').read_text() == 'changed data\n'
print('검증된 파일 집합 복원 로직과 기존 gate 복구 연결 확인', flush=True)
if caddy_base:
    print('시험 Caddy 유지 중 신규 서비스·작업자 소켓 정지 어댑터 확인', flush=True)
print('복원 연결 로직의 새 상태 보존과 기존 pause·Client 키 복원 확인 ' +
      ('(작업 상태는 모의)' if caddy_base else '(유지보수·작업 상태는 모의)'), flush=True)
print('실패 후 시험 데이터·기존 gate pause·Client 키 복원 확인', flush=True)
ctl('stop', studio, client, gate)
stopped()
print('시험 gate 보류와 변경된 데이터 보존:', fixture, stateparent, flush=True)
PY
if [[ ${BC250_FIXTURE_REAL_WIKI:-} == 1 ]]; then
  systemctl stop "$wiki_unit"
  rm -- "$wiki_file"
fi
rm -- "${units[@]/#/\/run\/systemd\/system\/}"
if [[ -n ${BC250_FIXTURE_CADDY_BASE:-} ]]; then
  rm -- "/run/systemd/system/$worker_unit" "/run/systemd/system/$worker_socket"
fi
systemctl daemon-reload
echo "시험 unit 정리 완료. 시험 기록 보관: $fixture"
