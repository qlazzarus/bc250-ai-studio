#!/usr/bin/env bash
# Disposable VM units only. A systemd condition is not a complete DB fence.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing \
  && ( $# == 1 || ( $# == 2 && $2 == reexec ) ) ]] || exit 1
fixture=$(mktemp -d /var/backups/bc250-db-restart-fence.XXXXXXXX)
suffix=${fixture##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
studio="bc250-db-studio-$suffix.service"
gate="bc250-db-gate-$suffix.service"
marker=$fixture/blocked
trap 'echo "시험 중단. 시험 unit과 기록 보존: $studio $gate $fixture" >&2' ERR
for unit in "$studio" "$gate"; do
  file=/run/systemd/system/$unit
  [[ ! -e $file && ! -L $file && ! -e /etc/systemd/system/$unit \
    && $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
  cat > "$file" <<EOF
[Unit]
ConditionPathExists=!$marker
[Service]
ExecStart=/usr/bin/sleep infinity
Restart=on-failure
RestartSec=1
KillMode=control-group
EOF
  chmod 0644 "$file"
  restorecon -F "$file"
done
restorecon -RF "$fixture"
systemctl daemon-reload
systemctl start "$studio" "$gate"
for unit in "$studio" "$gate"; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == active ]] || exit 1
  dropin=/run/systemd/system/$unit.d
  [[ ! -e $dropin && ! -L $dropin ]] || exit 1
  mkdir -m 0755 "$dropin"
  printf '[Service]\nRestart=no\n' > "$dropin/90-bc250-test.conf"
  chmod 0644 "$dropin/90-bc250-test.conf"
  restorecon -RF "$dropin"
done
systemctl daemon-reload
for unit in "$studio" "$gate"; do
  [[ $(systemctl show "$unit" -p Restart --value) == no \
    && $(systemctl show "$unit" -p ActiveState --value) == active \
    && $(systemctl show "$unit" -p NRestarts --value) == 0 ]] || {
    echo "시험 재시작 정책 확인 실패: $unit" >&2; exit 1;
  }
done
echo '실행 중인 두 시험 서비스의 runtime Restart=no 적용 확인'
touch "$marker"
for unit in "$studio" "$gate"; do
  systemctl kill --kill-whom=main --signal=KILL "$unit"
done
for unit in "$studio" "$gate"; do
  blocked=no
  for _ in {1..80}; do
    state=$(systemctl show "$unit" -p ActiveState --value)
    pid=$(systemctl show "$unit" -p MainPID --value)
    if [[ ( $state == inactive || $state == failed ) && $pid == 0 ]]; then blocked=yes; break; fi
    sleep .25
  done
  [[ $blocked == yes ]] || { echo "시험 자동 재시작 차단 확인 실패: $unit" >&2; exit 1; }
done
# Wait beyond RestartSec before checking that no automatic restart occurred.
sleep 2
for unit in "$studio" "$gate"; do
  [[ $(systemctl show "$unit" -p NRestarts --value) == 0 \
    && $(systemctl show "$unit" -p MainPID --value) == 0 ]] || exit 1
  systemctl start "$unit" || true
  [[ $(systemctl show "$unit" -p MainPID --value) == 0 \
    && $(systemctl show "$unit" -p ConditionResult --value) == no ]] || exit 1
done
echo '시험 Restart=no 적용 후 자동 재시작 부재와 명시적 시작 조건 차단 확인'
rm -- "$marker"
for unit in "$studio" "$gate"; do
  rm -- "/run/systemd/system/$unit.d/90-bc250-test.conf"
  rmdir -- "/run/systemd/system/$unit.d"
done
systemctl daemon-reload
systemctl start "$studio" "$gate"
for unit in "$studio" "$gate"; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == active \
    && $(systemctl show "$unit" -p Restart --value) == on-failure ]] || exit 1
done
echo '시험 조건과 override 제거 후 기존 재시작 정책 및 두 서비스 시작 확인'
python3 - "$1/deploy/model-control" "$studio" "$gate" "$fixture" "${2:-ordinary}" <<'PY'
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

source, studio, gate, fixture, mode = Path(sys.argv[1]), sys.argv[2], sys.argv[3], Path(sys.argv[4]), sys.argv[5]
sys.dont_write_bytecode = True
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
sequence = load('fixture_sequence', source / 'service-stop-fence-sequence.py')
backup_sequence = load('fixture_backup_sequence', source / 'legacy-backup-sequence.py')
journal_module = load('fixture_journal', source / 'migration-journal.py')
record_reader = load('fixture_record_reader', source / 'inspect-deployment-record.py')
watch_module = load('fixture_watch', source / 'old-studio-process-watch.py')
units = (studio, gate)
marker = fixture / 'blocked'
def show(unit, prop):
    return subprocess.check_output(['/usr/bin/systemctl', 'show', unit, '-p', prop, '--value'], text=True).strip()
pids = {unit: int(show(unit, 'MainPID')) for unit in units}
watches = {unit: watch_module.OldStudioProcessWatch(pid, watch_module.process_starttime(pid))
           for unit, pid in pids.items()}
def generation():
    return all(not watches[unit].exited() and show(unit, 'MainPID') == str(pids[unit]) for unit in units)
def disable_restart():
    for unit in units:
        directory = Path('/run/systemd/system') / (unit + '.d')
        directory.mkdir(mode=0o755)
        file = directory / '90-bc250-test.conf'
        with file.open('x') as out:
            out.write('[Service]\nRestart=no\n')
        file.chmod(0o644)
        subprocess.run(['/usr/sbin/restorecon', '-RF', str(directory)], check=True)
    subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True)
    return all(show(unit, 'Restart') == 'no' for unit in units)
def install_block():
    marker.touch(exist_ok=False)
    subprocess.run(['/usr/sbin/restorecon', '-F', str(marker)], check=True)
    return True
def policy():
    return marker.is_file() and all(show(unit, 'Restart') == 'no' for unit in units)
def stop():
    subprocess.run(['/usr/bin/systemctl', 'stop', *units], check=True, timeout=120)
    return True
def stopped():
    subprocess.run(['/usr/bin/bash', '-c', 'source "$1"; shift; bc250_require_stopped "$@"',
                    'fixture', str(source / 'backup-archive.sh'), *units], check=True, timeout=60)
    return True
record_dir = fixture / 'sequence-success'
record_dir.mkdir(mode=0o700)
journal = journal_module.MigrationJournal(record_dir)
runner = sequence.ServiceStopFence(record=journal, generation_current=generation, disable_restart=disable_restart,
    install_start_block=install_block, check_policy=policy, stop_services=stop, check_stopped=stopped)
try:
    drained = {'paused': True, 'active_requests': 0, 'waiting_requests': 0}
    busy = {'paused': True, 'active_requests': 1, 'waiting_requests': 0}
    def not_expected():
        raise RuntimeError('drain 확인 전에 시험 서비스를 정지하려 했습니다.')
    try:
        backup_sequence.backup_legacy(check_maintenance=lambda: True, capture_pause=lambda: drained,
            gate_status=lambda: busy, stop_services=not_expected, require_stopped=not_expected,
            create_backup=not_expected, verify_backup=lambda _: not_expected())
    except backup_sequence.SequenceError as error:
        if not isinstance(error.__cause__, backup_sequence.SequenceError) or 'drain' not in str(error.__cause__):
            raise
        if runner.phase != 'new' or marker.exists() or not generation():
            raise RuntimeError('시험 drain 거절 중 서비스 또는 차단 상태가 변경됐습니다.')
    else:
        raise RuntimeError('시험 gate의 요청이 남아 있는데 백업이 허용됐습니다.')
    print('모의 gate 요청이 남으면 시험 차단·정지 전 중단 확인', flush=True)
    backup_events = []
    def require_fenced():
        if runner.check() is not True:
            raise RuntimeError('시험 서비스 차단이 유지되지 않았습니다.')
    def create_fake_backup():
        require_fenced()
        backup_events.append('created')
        return fixture / 'fake-backup'
    def verify_fake_backup(value):
        require_fenced()
        if value != fixture / 'fake-backup':
            raise RuntimeError('시험 백업 경로가 다릅니다.')
        backup_events.append('verified')
    value = backup_sequence.backup_legacy(check_maintenance=lambda: True, capture_pause=lambda: drained,
        gate_status=lambda: drained, stop_services=runner.prepare, require_stopped=require_fenced,
        create_backup=create_fake_backup, verify_backup=verify_fake_backup)
    if value != fixture / 'fake-backup' or backup_events != ['created', 'verified']:
        raise RuntimeError('시험 서비스 정지와 모의 백업 연결 실패')
    print('모의 gate drain 후 시험 서비스 차단·정지와 모의 백업 연결 확인', flush=True)
    if mode == 'reexec':
        subprocess.run(['/usr/bin/systemctl', 'daemon-reexec'], check=True, timeout=120)
        if runner.check() is not True:
            raise RuntimeError('시험 systemd 재실행 후 차단 또는 정지 확인 실패')
        print('시험 systemd 재실행 후 runtime 정책·정지 및 cgroup 확인', flush=True)
    for unit in units:
        subprocess.run(['/usr/bin/systemctl', 'start', unit], check=False, timeout=60)
        if show(unit, 'MainPID') != '0' or show(unit, 'ConditionResult') != 'no':
            raise RuntimeError('시험 서비스 시작이 차단되지 않았습니다.')
    if runner.check() is not True:
        raise RuntimeError('시험 차단 상태가 유지되지 않았습니다.')
    events = [json.loads(line)['event'] for line in (record_dir / 'migration-events.jsonl').read_text().splitlines()]
    if events != ['service_restart_disable:begin', 'service_restart_disable:confirmed',
                  'service_start_block:begin', 'service_start_block:confirmed',
                  'service_stop_fence:begin', 'service_stop_fence:confirmed']:
        raise RuntimeError('시험 서비스 차단 완료 기록이 다릅니다.')
    print('시험 서비스 차단 단계별 시작·완료 기록 확인', flush=True)
    print('시험 두 서비스의 세대·재시작 정책·시작 차단·cgroup 정지 순서 연결 확인', flush=True)
    marker.unlink()
    if runner.check() is not False:
        raise RuntimeError('시험 차단 표시 상실이 허용됐습니다.')
    marker.touch(exist_ok=False)
    subprocess.run(['/usr/sbin/restorecon', '-F', str(marker)], check=True)
    if runner.check() is not False:
        raise RuntimeError('시험 차단 복원 후 자동 재승인이 허용됐습니다.')
    lost_events = [json.loads(line)['event'] for line in (record_dir / 'migration-events.jsonl').read_text().splitlines()]
    if lost_events != events + ['service_stop_fence:lost']:
        raise RuntimeError('시험 차단 상실 기록이 다릅니다.')
    stored_events = [row['event'] for row in record_reader.read_record_rows(record_dir)]
    if sequence.classify_record(stored_events) != '차단 상실 기록 있음':
        raise RuntimeError('시험 차단 상실 기록 분류 실패')
    corrupt_dir = fixture / 'sequence-corrupt'
    corrupt_dir.mkdir(mode=0o700)
    corrupt = corrupt_dir / 'migration-events.jsonl'
    corrupt.write_text('{"event":"service_stop_fence:lost","event":"other"}\n')
    corrupt.chmod(0o600)
    try:
        record_reader.read_record_rows(corrupt_dir)
    except ValueError:
        pass
    else:
        raise RuntimeError('중복 키가 있는 시험 기록이 허용됐습니다.')
    print('보호된 시험 차단 상실 기록 분류와 중복 키 거절 확인', flush=True)
    print('시험 차단 표시 상실 후 복원해도 자동 재승인 거절 확인', flush=True)
    print('시험 차단 상실의 단일 내구성 기록 확인', flush=True)
finally:
    for watch in watches.values():
        watch.close()
    journal.close()
PY
rm -- "$marker"
for unit in "$studio" "$gate"; do
  rm -- "/run/systemd/system/$unit.d/90-bc250-test.conf"
  rmdir -- "/run/systemd/system/$unit.d"
done
systemctl daemon-reload
systemctl start "$studio" "$gate"
for unit in "$studio" "$gate"; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == active \
    && $(systemctl show "$unit" -p Restart --value) == on-failure ]] || exit 1
done
echo '차단 순서 시험 후 원래 시험 재시작 정책과 시작 확인'
python3 - "$1/deploy/model-control" "$studio" "$gate" "$fixture" <<'PY'
import importlib.util
import json
import subprocess
import sys
import time
from pathlib import Path

source, studio, gate, fixture = Path(sys.argv[1]), sys.argv[2], sys.argv[3], Path(sys.argv[4])
sys.dont_write_bytecode = True
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
sequence = load('fixture_sequence', source / 'service-stop-fence-sequence.py')
journal_module = load('fixture_journal', source / 'migration-journal.py')
record_reader = load('fixture_record_reader', source / 'inspect-deployment-record.py')
watch_module = load('fixture_watch', source / 'old-studio-process-watch.py')
units = (studio, gate)
marker = fixture / 'blocked'
def show(unit, prop):
    return subprocess.check_output(['/usr/bin/systemctl', 'show', unit, '-p', prop, '--value'], text=True).strip()
pids = {unit: int(show(unit, 'MainPID')) for unit in units}
watches = {unit: watch_module.OldStudioProcessWatch(pid, watch_module.process_starttime(pid))
           for unit, pid in pids.items()}
def generation():
    return all(not watches[unit].exited() and show(unit, 'MainPID') == str(pids[unit]) for unit in units)
def disable_and_fail():
    for unit in units:
        directory = Path('/run/systemd/system') / (unit + '.d')
        directory.mkdir(mode=0o755)
        file = directory / '90-bc250-test.conf'
        with file.open('x') as out:
            out.write('[Service]\nRestart=no\n')
        file.chmod(0o644)
        subprocess.run(['/usr/sbin/restorecon', '-RF', str(directory)], check=True)
    subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True)
    if any(show(unit, 'Restart') != 'no' for unit in units):
        raise RuntimeError('시험 재시작 설정 실패')
    subprocess.run(['/usr/bin/systemctl', 'kill', '--kill-whom=main', '--signal=KILL', studio], check=True)
    deadline = time.monotonic() + 20
    while not watches[studio].exited():
        if time.monotonic() >= deadline:
            raise RuntimeError('시험 프로세스 종료 대기 시간 초과')
        time.sleep(.1)
    return True
def unexpected():
    raise RuntimeError('세대 변경 후 시험 차단 또는 정지가 실행됐습니다.')
record_dir = fixture / 'sequence-failure'
record_dir.mkdir(mode=0o700)
journal = journal_module.MigrationJournal(record_dir)
runner = sequence.ServiceStopFence(record=journal, generation_current=generation, disable_restart=disable_and_fail,
    install_start_block=unexpected, check_policy=unexpected, stop_services=unexpected, check_stopped=unexpected)
try:
    try:
        runner.prepare()
    except sequence.ServiceStopFenceError as error:
        if not isinstance(error.__cause__, ValueError) or '서비스 세대' not in str(error.__cause__):
            raise
    else:
        raise RuntimeError('시험 프로세스 종료 후 차단 순서가 허용됐습니다.')
    if marker.exists() or runner.phase != 'failed' or show(gate, 'ActiveState') != 'active':
        raise RuntimeError('실패 후 시험 표시 또는 다른 서비스 상태가 다릅니다.')
    events = [json.loads(line)['event'] for line in (record_dir / 'migration-events.jsonl').read_text().splitlines()]
    if events != ['service_restart_disable:begin']:
        raise RuntimeError('시험 실패 시 미완료 기록이 다릅니다.')
    stored_events = [row['event'] for row in record_reader.read_record_rows(record_dir)]
    if sequence.classify_record(stored_events) != '작업 결과 미확인':
        raise RuntimeError('시험 미완료 기록 분류 실패')
    print('보호된 시험 미완료 기록 분류 확인', flush=True)
    print('재시작 정책 적용 중 실패 시 시작 기록만 보존 확인', flush=True)
    for unit in units:
        if show(unit, 'Restart') != 'no' or not (Path('/run/systemd/system') / (unit + '.d') / '90-bc250-test.conf').is_file():
            raise RuntimeError('시험 실패 후 재시작 설정이 보존되지 않았습니다.')
    try:
        runner.prepare()
    except sequence.ServiceStopFenceError:
        pass
    else:
        raise RuntimeError('시험 실패 후 자동 재시도가 허용됐습니다.')
    print('시험 재시작 정책 적용 중 세대 종료 시 표시 생성 전 중단과 override 보존 확인', flush=True)
finally:
    for watch in watches.values():
        watch.close()
    journal.close()
PY
for unit in "$studio" "$gate"; do
  rm -- "/run/systemd/system/$unit.d/90-bc250-test.conf"
  rmdir -- "/run/systemd/system/$unit.d"
done
systemctl daemon-reload
systemctl reset-failed "$studio" "$gate"
systemctl start "$studio" "$gate"
for unit in "$studio" "$gate"; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == active \
    && $(systemctl show "$unit" -p Restart --value) == on-failure ]] || exit 1
done
echo '경합 시험 후 기존 시험 정책과 서비스 시작 확인'
systemctl stop "$studio" "$gate"
rm -- "/run/systemd/system/$studio" "/run/systemd/system/$gate"
systemctl daemon-reload
trap - ERR
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture"
echo '시험 runtime 조건만 확인했습니다. 재부팅·다른 프로세스·DB 쓰기·운영 서비스는 시험하지 않았습니다.'
