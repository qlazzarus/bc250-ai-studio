#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
evidence=$(mktemp -d /var/backups/bc250-migration-backup-record.XXXXXXXX)
backup=$(mktemp -d /var/backups/bc250-model-migration.XXXXXXXX)
trap 'echo "시험 중단. 시험 기록을 보존합니다: $evidence $backup" >&2' ERR
python3 - "$source_dir" "$evidence" "$backup" <<'PY'
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

source, evidence, backup = map(Path, sys.argv[1:])
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, source / 'deploy/model-control' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
journal = load('journal', 'migration-journal.py')
coordinator = load('coordinator', 'coordinated-migration.py')
record = journal.MigrationJournal(evidence)
events = []
def install(path):
    rows = [json.loads(line) for line in (evidence / 'migration-events.jsonl').read_text().splitlines()]
    if (len(rows) < 3 or rows[-3].get('event') != 'legacy_backup:path'
            or rows[-3].get('path') != str(backup)
            or rows[-2].get('event') != 'legacy_backup:confirmed'
            or rows[-1].get('event') != 'install:begin'):
        raise ValueError('설치 전 백업 경로와 완료 기록이 없습니다.')
    events.append('install')
    return True
runner = coordinator.CoordinatedMigration(
    record=record, preflight=lambda: True, transition=lambda **_: None, transition_args={},
    backup_adapter=SimpleNamespace(run=lambda: backup), install=install,
    startup=SimpleNamespace(start=lambda: None, finish=lambda: None),
    verify_new=lambda: True, verify_restored=lambda: True)
runner.prepare_and_start()
if events != ['install'] or runner.phase != 'await_client':
    raise SystemExit('시험 배포 순서가 올바르지 않습니다.')
try:
    record.backup('/tmp/invalid-backup')
except ValueError:
    pass
else:
    raise SystemExit('허용되지 않은 백업 경로를 기록했습니다.')
record.close()
print('시험 백업 경로의 설치 전 영구 기록과 잘못된 경로 거절 확인', flush=True)
PY
echo "시험 기록과 빈 백업 디렉터리 보관: $evidence $backup"
