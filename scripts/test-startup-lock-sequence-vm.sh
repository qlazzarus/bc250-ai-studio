#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /var/lib/bc250-startup-lock.XXXXXXXX)
tools=$(mktemp -d /opt/bc250-startup-lock.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-startup-lock.XXXXXXXX)
chmod 0755 "$tools"
trap 'echo "시험 중단. 시험 파일과 기록 보존: $fixture $tools $records" >&2' ERR
for name in startup-lock-sequence.py gpu-lock-handoff.py advisory-gpu-fence.py migration-journal.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$tools/$name"
done
restorecon -RF "$fixture" "$tools" "$records"
python3 - "$fixture" "$tools" "$records" <<'PY'
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

fixture, tools, records = map(Path, sys.argv[1:])
sys.dont_write_bytecode = True
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, tools / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
sequence = load('fixture_sequence', 'startup-lock-sequence.py')
handoff = load('fixture_handoff', 'gpu-lock-handoff.py')
fence = load('fixture_fence', 'advisory-gpu-fence.py')
journal_module = load('fixture_journal', 'migration-journal.py')
probe = '''import fcntl, os, sys
fd = os.open(sys.argv[1], os.O_RDWR | os.O_NOFOLLOW)
try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError: raise SystemExit(42)
os.close(fd)
'''
def setup(name, succeed):
    lock = fixture / (name + '.lock')
    config = tools / (name + '.conf')
    config.write_text('f ' + str(lock) + ' 0600 root root -\n')
    folder = records / name
    folder.mkdir(mode=0o700)
    journal = journal_module.MigrationJournal(folder)
    # Gate and other fences are explicitly simulated in this fixture.
    gates = {'startup': True, 'deployment': True}
    held = fence.AdvisoryGPUFence(lock, group_id=0)
    prepare = lambda: subprocess.run(['/usr/bin/systemd-tmpfiles', '--create', str(config)], check=True) is not None
    guard = handoff.GPULockHandoff(fence=held, old_generation_gone=lambda: True,
        other_callers_blocked=lambda: True, gpu_safe=lambda: True,
        prepare_new_lock=lambda: lock.is_file())
    def confirm():
        result = subprocess.run(['/usr/bin/python3', '-c', probe, str(lock)], check=False)
        if result.returncode != 0: raise RuntimeError('시작 확인이 시험 잠금을 획득하지 못했습니다.')
        return succeed
    runner = sequence.StartupLockSequence(record=journal, check_pre_handoff=lambda: gates['startup'],
        prepare_tmpfiles=prepare, handoff=guard, check_before_confirm=lambda: gates['startup'],
        check_deployment_hold=lambda: gates['deployment'], confirm_startup=confirm)
    return runner, held, journal, folder, gates

runner, held, journal, folder, gates = setup('success', True)
try:
    runner.begin()
    if not held.check(): raise RuntimeError('시험 시작 잠금이 없습니다.')
    if not runner.confirm_after_client_restart(): raise RuntimeError('시험 시작 확인 실패')
    rows = [json.loads(line)['event'] for line in (folder / 'migration-events.jsonl').read_text().splitlines()]
    if rows[-3:] != ['startup_lock_transfer:begin', 'startup_lock_transfer:released', 'startup_lock_transfer:confirmed']:
        raise RuntimeError('시험 잠금 인계 기록이 다릅니다.')
    print('시험 tmpfiles 준비 후 잠금 보유·시작 확인 전 인계와 재획득 확인', flush=True)
finally: journal.close()
runner, held, journal, folder, gates = setup('failure', False)
try:
    runner.begin()
    try: runner.confirm_after_client_restart()
    except sequence.StartupLockError: pass
    else: raise RuntimeError('시험 시작 확인 실패를 허용했습니다.')
    rows = [json.loads(line)['event'] for line in (folder / 'migration-events.jsonl').read_text().splitlines()]
    if rows[-1] != 'startup_lock_transfer:released' or not gates['startup'] or held.fd is not None:
        raise RuntimeError('시험 인계 후 실패 기록 또는 상태 오류')
    print('시험 인계 후 확인 실패 시 미완료 기록과 모의 startup 보류 유지 확인', flush=True)
finally: journal.close()
runner, held, journal, folder, gates = setup('lost-deployment', True)
try:
    runner.begin()
    gates['deployment'] = False
    try: runner.confirm_after_client_restart()
    except sequence.StartupLockError: pass
    else: raise RuntimeError('시험 배포 보류 상실을 허용했습니다.')
    rows = [json.loads(line)['event'] for line in (folder / 'migration-events.jsonl').read_text().splitlines()]
    if rows[-1] != 'startup_lock:confirmed' or held.fd is None or not held.check():
        raise RuntimeError('시험 보류 상실 후 잠금 또는 기록이 다릅니다.')
    print('모의 배포 보류 상실 시 시작 확인 전 중단과 시험 잠금 유지 확인', flush=True)
finally:
    if held.fd is not None: held.release()
    journal.close()
print('Studio·gate·Client·GPU 안전·직접 호출 차단과 실제 시작 확인은 모의입니다.', flush=True)
PY
echo "시험 파일 보관: $fixture $tools $records"
