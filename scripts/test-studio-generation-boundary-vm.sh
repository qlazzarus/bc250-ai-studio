#!/usr/bin/env bash
# Disposable systemd fixture only; preserve unit and evidence on failure.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
tools=$(mktemp -d /opt/bc250-studio-generation.XXXXXXXX)
chmod 0755 "$tools"
unit=bc250-studio-generation-fixture.service
unit_file="/etc/systemd/system/$unit"
[[ ! -e $unit_file && ! -L $unit_file && $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록 보존: $unit_file $tools" >&2' ERR
for file in old-studio-process-watch.py studio-generation-boundary.py backup-archive.sh check-service-cgroup.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$file" "$tools/$file"
done
cat > "$unit_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
restorecon -RF "$tools" "$unit_file"
systemctl daemon-reload
python3 - "$tools" "$unit" <<'PY'
import importlib.util
import subprocess
import sys
from pathlib import Path
tools = Path(sys.argv[1])
unit = sys.argv[2]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('studio_watch', tools / 'old-studio-process-watch.py')
watch_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch_module)
boundary_spec = importlib.util.spec_from_file_location('studio_boundary', tools / 'studio-generation-boundary.py')
boundary_module = importlib.util.module_from_spec(boundary_spec)
boundary_spec.loader.exec_module(boundary_module)
def ctl(*args):
    return subprocess.run(['/usr/bin/systemctl', *args], check=True, capture_output=True, text=True).stdout
def stopped():
    return subprocess.run(['/usr/bin/bash', '-c', 'source "$1"; bc250_require_stopped "$2"',
                           'fixture', str(tools / 'backup-archive.sh'), unit],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
def main_pid():
    value = ctl('show', unit, '-p', 'MainPID', '--value').strip()
    if not value.isdecimal() or int(value) <= 1:
        raise RuntimeError('시험 주 프로세스를 확인하지 못했습니다.')
    return int(value)
ctl('start', unit)
old_pid = main_pid()
old = watch_module.OldStudioProcessWatch(old_pid, watch_module.process_starttime(old_pid))
def observe_new():
    pid = main_pid()
    return pid, watch_module.process_starttime(pid)
def verify_new(identity):
    # Fixture only: a real caller must verify the release and the full service.
    return observe_new() == identity
candidate = boundary_module.StudioGenerationBoundary(old, check_stopped=stopped,
    observe_replacement=observe_new, verify_replacement=verify_new)
try:
    if old.exited() or stopped():
        raise RuntimeError('기존 시험 서비스 실행 중 정지로 판단했습니다.')
    early = boundary_module.StudioGenerationBoundary(old, check_stopped=stopped,
        observe_replacement=observe_new, verify_replacement=verify_new)
    try:
        early.mark_stopped()
    except boundary_module.GenerationError:
        pass
    else:
        raise RuntimeError('실행 중인 기존 시험 서비스 정지를 허용했습니다.')
    ctl('stop', unit)
    if not candidate.mark_stopped():
        raise RuntimeError('시험 세대 정지 등록 실패')
    if not old.exited() or not stopped():
        raise RuntimeError('기존 시험 서비스의 종료 또는 cgroup 정지 확인 실패')
    print('기존 시험 서비스 실행 중 정지 거절과 정지 후 주 프로세스·cgroup 확인', flush=True)
    ctl('start', unit)
    new_pid = main_pid()
    if not candidate.bind_replacement() or not candidate.check():
        raise RuntimeError('신규 시험 세대 검사 실패')
    if new_pid == old_pid or not old.exited() or stopped():
        raise RuntimeError('새 시험 서비스 세대 구분에 실패했습니다.')
    print('새 시험 서비스 기동 중 기존 주 프로세스 종료와 활성 unit 정지 거절 확인', flush=True)
    ctl('stop', unit)
    try:
        candidate.check()
    except Exception:
        pass
    else:
        raise RuntimeError('신규 시험 세대 종료를 거절하지 못했습니다.')
    if not stopped():
        raise RuntimeError('새 시험 서비스 정지 확인 실패')
    print('신규 시험 세대 종료 시 확인 실패와 재사용 거절 확인', flush=True)
    try:
        candidate.check()
    except boundary_module.GenerationError:
        pass
    else:
        raise RuntimeError('실패한 시험 세대 검사를 다시 허용했습니다.')
finally:
    old.close()
PY
rm -- "$unit_file"
systemctl daemon-reload
trap - ERR
echo "시험 unit 정리 완료; 시험 도구 보관: $tools"
echo '신규 코드·전체 cgroup 신뢰 검사는 모의이며 직접 호출 차단·GPU·실제 Studio는 시험하지 않았습니다.'
