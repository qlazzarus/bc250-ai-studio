#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-rollback-wiki.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-rollback-wiki.XXXXXXXX)
evidence=$(mktemp -d /var/backups/bc250-model-postfailure.XXXXXXXX)
stage=$(mktemp -d /var/backups/bc250-restore-stage.XXXXXXXX)
chmod 0755 "$fixture"
unit=bc250-rollback-wiki-fixture.service
unit_file=/etc/systemd/system/$unit
dropin=/etc/systemd/system/$unit.d
marker=/var/lib/bc250-rollback-wiki-fixture
for path in "$unit_file" "$dropin" "$marker"; do [[ ! -e $path && ! -L $path ]] || exit 1; done
[[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록 보존: $fixture $records $evidence $stage $unit_file $dropin $marker" >&2' ERR
for name in legacy-rollback-manual.py migration-journal.py wiki-condition-fence.py wiki-maintenance-fence.py read-systemd-conditions.py verify-wiki-condition.py check-service-cgroup.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$fixture/$name"
done
cat > "$unit_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
restorecon -RF "$fixture" "$records" "$evidence" "$stage"
restorecon -F "$unit_file"
systemctl daemon-reload
systemctl start "$unit"
python3 - "$fixture" "$records" "$evidence" "$stage" "$unit" "$marker" <<'PY'
import importlib.util
import json
import sys
from pathlib import Path
fixture, records, evidence, stage = map(Path, sys.argv[1:5])
unit, marker = sys.argv[5], Path(sys.argv[6])
sys.dont_write_bytecode = True
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, fixture / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
manual = load('manual', 'legacy-rollback-manual.py')
journal_module = load('journal', 'migration-journal.py')
wiki_module = load('wiki', 'wiki-condition-fence.py')
wiki_module.UNIT, wiki_module.PERSISTENT_MARKER = unit, marker

def setup(name, safe=True):
    folder = records / name
    folder.mkdir(mode=0o700)
    wiki_folder = folder / 'wiki'
    wiki_folder.mkdir(mode=0o700)
    wiki = wiki_module.WikiConditionFence(fixture, wiki_folder, persistent=True)
    wiki.acquire()
    journal = journal_module.MigrationJournal(folder)
    journal.release('a' * 40, 'b' * 64)
    actions, client = [], [False]
    def action(name, result=None):
        def run(*args):
            actions.append(name)
            return result
        return run
    runner = manual.ManualRollback(record=journal, wiki_fence=wiki, check_maintenance=lambda: True,
        inspect_new=lambda: True, stop_new=action('stop'), require_stopped=action('stopped'),
        preserve_new=action('preserve', evidence), recovery_safe=lambda _: safe,
        verify_backup=action('verify_backup'), stage_backup=action('stage', stage),
        restore_legacy=action('restore'), start_legacy_gate=action('gate'),
        restore_pause=action('pause'), start_legacy_studio=action('studio'),
        client_stopped=lambda: True, verify_legacy=lambda: client[0],
        restore_ingress=action('ingress', True))
    return runner, wiki, journal, actions, client, folder

runner, wiki, journal, actions, client, folder = setup('success')
try:
    runner.begin()
    if runner.phase != 'await_client' or wiki.check() is not True or 'ingress' in actions:
        raise RuntimeError('수동 Client 대기 또는 Wiki 차단 실패')
    print('시험 기존 gate·Studio 복구 후 Client 수동 재시작 대기와 Wiki 차단 확인', flush=True)
    client[0] = True  # Simulated operator restart and verification.
    runner.finish_after_client_restart()
    rows = [json.loads(line) for line in (folder / 'migration-events.jsonl').read_text().splitlines()]
    events = [row['event'] for row in rows]
    if runner.phase != 'complete' or actions[-1] != 'ingress' or events.index('rollback_wiki_release:confirmed') >= events.index('rollback_ingress_restore:begin'):
        raise RuntimeError('복구 완료 순서 오류')
    if not any(row.get('path') == str(evidence) for row in rows) or not any(row.get('path') == str(stage) for row in rows):
        raise RuntimeError('보존 또는 복원 경로 기록 누락')
    print('시험 Client 확인 뒤 Wiki 원상 복원 및 유지보수 복원 순서 확인', flush=True)
finally:
    journal.close()
runner, wiki, journal, actions, client, folder = setup('unsafe', safe=False)
try:
    try:
        runner.begin()
    except manual.RollbackError:
        pass
    else:
        raise RuntimeError('안전하지 않은 보존 상태를 거절하지 못했습니다')
    wiki.check()
    rows = [json.loads(line) for line in (folder / 'migration-events.jsonl').read_text().splitlines()]
    if 'restore' in actions or not any(row.get('path') == str(evidence) for row in rows):
        raise RuntimeError('실패 시 복원 중단 또는 보존 기록 오류')
    print('시험 보존 상태 검증 실패 시 Wiki 차단 및 증거 경로 기록 유지 확인', flush=True)
    wiki.release(can_release=lambda: True)  # Dispose of this fixture only.
finally:
    journal.close()
print('gate·Studio·Client·데이터·Caddy는 모의이며 실제 운영 서비스는 변경하지 않았습니다.', flush=True)
PY
systemctl stop "$unit"
rm -- "$unit_file"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture $records $evidence $stage"
