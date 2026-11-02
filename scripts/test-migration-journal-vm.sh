#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
evidence=$(mktemp -d /var/backups/bc250-migration-journal.XXXXXXXX)
trap 'echo "시험 중단. 시험 기록을 보존합니다: $evidence" >&2' ERR
python3 - "$source_dir" "$evidence" <<'PY'
import importlib.util
import json
import os
import signal
import sys
from pathlib import Path
from types import SimpleNamespace

source, evidence = map(Path, sys.argv[1:])
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, source / 'deploy/model-control' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
journal = load('journal', 'migration-journal.py')
coordinator = load('coordinator', 'coordinated-migration.py')
crash_dir = evidence / 'crash'
crash_dir.mkdir(mode=0o700)
pid = os.fork()
if pid == 0:
    record = journal.MigrationJournal(crash_dir)
    record('maintenance_enter:begin')
    os.kill(os.getpid(), signal.SIGKILL)
    os._exit(1)
_, status = os.waitpid(pid, 0)
if not os.WIFSIGNALED(status) or os.WTERMSIG(status) != signal.SIGKILL:
    raise SystemExit('시험 강제 종료를 확인하지 못했습니다.')
rows = [json.loads(line) for line in (crash_dir / 'migration-events.jsonl').read_text().splitlines()]
if len(rows) != 1 or rows[0]['event'] != 'maintenance_enter:begin':
    raise SystemExit('강제 종료 후 미확인 단계 기록이 다릅니다.')
try:
    journal.MigrationJournal(crash_dir)
except FileExistsError:
    print('시험 강제 종료 시 시작 기록 보존과 기존 기록 재사용 거절 확인', flush=True)
else:
    raise SystemExit('기존 기록 재사용을 잘못 허용했습니다.')
normal_dir = evidence / 'failure'
normal_dir.mkdir(mode=0o700)
record = journal.MigrationJournal(normal_dir)
calls = []
def transition(*, mode):
    calls.append(mode)
    raise OSError('simulated response loss')
runner = coordinator.CoordinatedMigration(
    record=record, preflight=lambda: True, transition=transition, transition_args={},
    backup_adapter=SimpleNamespace(run=lambda: calls.append('backup')),
    install=lambda _: True, startup=SimpleNamespace(start=lambda: None, finish=lambda: None),
    verify_new=lambda: True, verify_restored=lambda: True)
try:
    runner.prepare_and_start()
except coordinator.MigrationError:
    pass
else:
    raise SystemExit('시험 유지보수 응답 유실을 잘못 허용했습니다.')
record.close()
rows = [json.loads(line) for line in (normal_dir / 'migration-events.jsonl').read_text().splitlines()]
if calls != ['enter'] or [row['event'] for row in rows] != ['maintenance_enter:begin']:
    raise SystemExit('시험 실패 후속 동작이나 기록이 다릅니다.')
print('시험 유지보수 결과 불명확 시 백업 전 중단과 미확인 기록 확인', flush=True)
PY
echo "시험 기록 보관: $evidence"
