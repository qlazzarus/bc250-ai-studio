#!/usr/bin/env bash
# Resume only the identified disposable gate fixture; never load production settings.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 0 ]] || exit 1
fixture=/opt/bc250-uncertain-gate.ct0aaddf
state=/var/lib/bc250-uncertain-gate.F59wp9SN
records=/var/backups/bc250-uncertain-gate.2oHaREgm
unit=bc250-uncertain-gate-fixture.service
unit_file=/etc/systemd/system/$unit
for path in "$fixture" "$state" "$records"; do
  [[ -d $path && ! -L $path && $(stat -c %u "$path") == 0 ]] || { echo '시험 경로 확인 실패' >&2; exit 1; }
done
[[ ! -e $state/gpu.lock && ! -L $state/gpu.lock && ! -e $records/response-lost && ! -L $records/response-lost ]] || { echo '기존 시험 결과가 있습니다. 보존하고 중단합니다.' >&2; exit 1; }
[[ $(systemctl show "$unit" -p LoadState --value) == loaded && $(systemctl show "$unit" -p ActiveState --value) == active ]] || { echo '시험 gate 실행 상태 확인 실패' >&2; exit 1; }
python3 - "$unit_file" "$fixture" <<'CHECK'
import stat
import sys
from pathlib import Path
unit, fixture = map(Path, sys.argv[1:])
expected = ('[Service]\n'
            f'EnvironmentFile={fixture}/gate.env\n'
            'ExecStart=/opt/bc250-model-control/.venv/bin/python -I -m uvicorn app.gate:create_gate_app '
            f'--factory --app-dir {fixture}/backend --host 127.0.0.1 --port 18887 --workers 1 --no-access-log\n'
            'KillMode=control-group\n')
info = unit.lstat()
if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or unit.read_text() != expected:
    raise SystemExit('시험 unit이 예상과 다릅니다. 보존하고 중단합니다.')
print('기존 시험 gate와 unit 확인 완료', flush=True)
CHECK
trap 'echo "시험 중단. 시험 unit과 기록 보존: $fixture $state $records $unit_file" >&2' ERR
python3 - "$fixture" "$state" "$records" <<'PY'
import fcntl
import importlib.util
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

fixture, state, records = map(Path, sys.argv[1:])
sys.dont_write_bytecode = True

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, fixture / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

sequence = load('fixture_sequence', 'startup-lock-sequence.py')
handoff = load('fixture_handoff', 'gpu-lock-handoff.py')
fence = load('fixture_fence', 'advisory-gpu-fence.py')
journal_module = load('fixture_journal', 'migration-journal.py')
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
key = 'fixture-admin-key-0123456789abcdef'

def request(method, suffix=''):
    req = urllib.request.Request('http://127.0.0.1:18887/control' + suffix,
        headers={'Authorization': 'Bearer ' + key}, method=method)
    with opener.open(req, timeout=5) as response:
        return json.load(response)

for attempt in range(120):
    try:
        initial = request('GET')
        break
    except urllib.error.URLError as error:
        if (type(error) is not urllib.error.URLError
                or not isinstance(error.reason, ConnectionRefusedError) or attempt == 119):
            raise
        time.sleep(.5)
if set(initial['holds']) != {'startup', 'admin-fixture'}:
    raise RuntimeError('시험 gate의 초기 보류가 다릅니다.')

lock = state / 'gpu.lock'
lock.touch(mode=0o600)
held = fence.AdvisoryGPUFence(lock, group_id=0)
folder = records / 'response-lost'
folder.mkdir(mode=0o700)
journal = journal_module.MigrationJournal(folder)
attempts = [0]

def startup_held():
    status = request('GET')
    return status['paused'] is True and 'startup' in status['holds']

def confirm_then_lose_response():
    attempts[0] += 1
    fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        request('DELETE', '/holds/startup')
        # Actual fixture gate applied the request; simulate loss before caller observes success.
        raise TimeoutError('simulated response loss')
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

guard = handoff.GPULockHandoff(fence=held, old_generation_gone=lambda: True,
    other_callers_blocked=lambda: True, gpu_safe=lambda: True, prepare_new_lock=lambda: lock.is_file())
runner = sequence.StartupLockSequence(record=journal, check_pre_handoff=startup_held,
    prepare_tmpfiles=lambda: True, handoff=guard, check_before_confirm=startup_held,
    confirm_startup=confirm_then_lose_response)
try:
    runner.begin()
    try:
        runner.confirm_after_client_restart()
    except sequence.StartupLockError:
        pass
    else:
        raise RuntimeError('시험 응답 유실이 감지되지 않았습니다.')
    status = request('GET')
    if set(status['holds']) != {'admin-fixture'} or status['paused'] is not True:
        raise RuntimeError('시험 gate 보류 적용 결과가 다릅니다.')
    rows = [json.loads(line)['event'] for line in (folder / 'migration-events.jsonl').read_text().splitlines()]
    if rows[-1] != 'startup_lock_transfer:released' or attempts[0] != 1 or held.fd is not None:
        raise RuntimeError('시험 인계 기록 또는 재시도 횟수가 다릅니다.')
    try:
        runner.confirm_after_client_restart()
    except sequence.StartupLockError:
        pass
    else:
        raise RuntimeError('시험 확인 재시도가 허용됐습니다.')
    if attempts[0] != 1:
        raise RuntimeError('시험 gate 요청이 재시도됐습니다.')
    print('시험 gate의 startup 보류 해제 적용 후 응답 유실 시 자동 재시도 거절 확인', flush=True)
    print('시험 관리자 보류 유지와 잠금 해제·확인 미완료 기록 확인', flush=True)
finally:
    journal.close()
print('gate는 시험 서비스이며 Client·Studio·GPU 안전·직접 호출 차단과 전체 시작 검증은 모의입니다.', flush=True)
PY
cleanup=$(mktemp -d "$records/cleanup.XXXXXXXX")
cp -a -- "$unit_file" "$cleanup/unit-before-cleanup.service"
systemctl stop "$unit"
[[ $(systemctl show "$unit" -p ActiveState --value) == inactive && $(systemctl show "$unit" -p MainPID --value) == 0 ]] || { echo '시험 gate 정지 확인 실패' >&2; exit 1; }
mv -- "$unit_file" "$cleanup/removed-unit.service"
systemctl daemon-reload
echo "시험 gate unit 정리 완료; 기존 및 신규 시험 기록 보관: $fixture $state $records"
