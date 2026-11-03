#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-coordinator-wiki.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-coordinator-wiki.XXXXXXXX)
backup=$(mktemp -d /var/backups/bc250-model-migration.XXXXXXXX)
chmod 0755 "$fixture"
unit=bc250-coordinator-wiki-fixture.service
unit_file=/etc/systemd/system/$unit
dropin=/etc/systemd/system/$unit.d
marker=/var/lib/bc250-coordinator-wiki-fixture
for path in "$unit_file" "$dropin" "$marker"; do [[ ! -e $path && ! -L $path ]] || exit 1; done
[[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $fixture $records $backup $unit_file $dropin $marker" >&2' ERR
for name in coordinated-migration.py migration-journal.py wiki-condition-fence.py wiki-maintenance-fence.py \
  read-systemd-conditions.py verify-wiki-condition.py check-service-cgroup.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$fixture/$name"
done
cat > "$unit_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
restorecon -RF "$fixture" "$records" "$backup"
restorecon -F "$unit_file"
systemctl daemon-reload
systemctl start "$unit"
python3 - "$fixture" "$records" "$backup" "$unit" "$marker" <<'PY'
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

fixture, records, backup = map(Path, sys.argv[1:4])
unit, marker = sys.argv[4], Path(sys.argv[5])
sys.dont_write_bytecode = True
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, fixture / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
coordinator = load('fixture_coordinator', 'coordinated-migration.py')
journal_module = load('fixture_journal', 'migration-journal.py')
wiki_module = load('fixture_wiki', 'wiki-condition-fence.py')
wiki_module.UNIT = unit
wiki_module.PERSISTENT_MARKER = marker
def setup(name, failure=False):
    folder = records / name
    folder.mkdir(mode=0o700)
    wiki_folder = folder / 'wiki'
    wiki_folder.mkdir(mode=0o700)
    wiki = wiki_module.WikiConditionFence(fixture, wiki_folder, persistent=True)
    journal = journal_module.MigrationJournal(folder)
    journal.release('a' * 40, 'b' * 64)
    events = []
    def transition(*, mode): events.append('caddy-' + mode)
    def install(_):
        events.append('install')
        if failure:
            raise ValueError('injected fixture failure')
        return True
    runner = coordinator.CoordinatedMigration(record=journal, preflight=lambda: True,
        transition=transition, transition_args={}, backup_adapter=SimpleNamespace(run=lambda: backup),
        install=install, startup=SimpleNamespace(start=lambda: None, finish=lambda: None),
        verify_new=lambda: True, verify_restored=lambda: True, wiki_fence=wiki)
    return runner, wiki, journal, events, folder
runner, wiki, journal, events, folder = setup('success')
try:
    runner.prepare_and_start()
    if runner.phase != 'await_client' or wiki.check() is not True:
        raise SystemExit('시험 Client 대기 중 Wiki 차단이 유지되지 않았습니다.')
    subprocess.run(['/usr/bin/systemctl', 'start', unit], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wiki.check()
    runner.finish_after_client_restart()
    if runner.phase != 'complete' or events != ['caddy-enter', 'install', 'caddy-restore']:
        raise SystemExit('시험 배포 연결 순서가 다릅니다.')
finally:
    journal.close()
print('시험 Client 수동 경계 동안 Wiki 차단과 완료 후 기존 상태 복원 확인', flush=True)
runner, wiki, journal, events, folder = setup('failure', failure=True)
try:
    try:
        runner.prepare_and_start()
    except coordinator.MigrationError:
        pass
    else:
        raise SystemExit('시험 설치 실패가 감지되지 않았습니다.')
    wiki.check()
    rows = [json.loads(line)['event'] for line in (folder / 'migration-events.jsonl').read_text().splitlines()]
    if 'install:begin' not in rows or 'install:confirmed' in rows or 'wiki_release:begin' in rows or 'caddy-restore' in events:
        raise SystemExit('시험 실패 기록 또는 차단 유지가 올바르지 않습니다.')
    print('시험 설치 실패 시 Wiki 차단·유지보수와 미완료 기록 보존 확인', flush=True)
    # Only this disposable fixture is restored after proving the fail-stop state.
    wiki.release(can_release=lambda: True)
finally:
    journal.close()
print('Caddy·gate·백업·설치·Client는 모의이며 실제 운영 서비스는 변경하지 않았습니다.', flush=True)
PY
systemctl stop "$unit"
rm -- "$unit_file"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture $records $backup"
