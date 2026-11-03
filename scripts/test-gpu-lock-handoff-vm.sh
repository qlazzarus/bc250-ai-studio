#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /var/lib/bc250-gpu-handoff.XXXXXXXX)
tools=$(mktemp -d /opt/bc250-gpu-handoff.XXXXXXXX)
chmod 0755 "$tools"
unit=bc250-handoff-old-fixture.service
unit_file=/etc/systemd/system/$unit
[[ ! -e $unit_file && ! -L $unit_file && $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $fixture $tools $unit_file" >&2' ERR
for name in gpu-lock-handoff.py advisory-gpu-fence.py backup-archive.sh check-service-cgroup.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$tools/$name"
done
cat > "$unit_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
restorecon -RF "$fixture" "$tools"
restorecon -F "$unit_file"
systemctl daemon-reload
systemctl start "$unit"
python3 - "$fixture" "$tools" "$unit" <<'PY'
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

fixture, tools = map(Path, sys.argv[1:3])
unit = sys.argv[3]
sys.dont_write_bytecode = True
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
handoff_module = load('fixture_handoff', tools / 'gpu-lock-handoff.py')
fence_module = load('fixture_fence', tools / 'advisory-gpu-fence.py')
path = fixture / 'new-gpu.lock'
blocked = [True]
def old_stopped():
    result = subprocess.run(['/usr/bin/bash', '-c', 'source "$1"; shift; bc250_require_stopped "$@"',
        'fixture', str(tools / 'backup-archive.sh'), unit], stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, check=False)
    return result.returncode == 0

def prepare():
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    return True

def make_handoff():
    fence = fence_module.AdvisoryGPUFence(path, group_id=0)
    candidate = handoff_module.GPULockHandoff(fence=fence, old_generation_gone=old_stopped,
        other_callers_blocked=lambda: blocked[0], gpu_safe=lambda: True, prepare_new_lock=prepare)
    return candidate, fence

candidate, fence = make_handoff()
try:
    candidate.acquire()
except handoff_module.HandoffError:
    pass
else:
    raise RuntimeError('기존 시험 서비스 실행 중 잠금 이전을 허용했습니다.')
if path.exists() or fence.fd is not None:
    raise RuntimeError('기존 시험 서비스 실행 중 신규 잠금이 생성됐습니다.')
print('시험 기존 Studio 실행 중 신규 잠금 준비 전 거절 확인', flush=True)
subprocess.run(['/usr/bin/systemctl', 'stop', unit], check=True)
candidate, fence = make_handoff()
if candidate.acquire() is not True or candidate.check() is not True:
    raise RuntimeError('시험 잠금 이전 실패')
probe = '''import fcntl, os, sys
fd = os.open(sys.argv[1], os.O_RDWR)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit(42)
'''
if subprocess.run(['/usr/bin/python3', '-c', probe, str(path)], check=False).returncode != 42:
    raise RuntimeError('신규 시험 잠금이 배타적이지 않습니다.')
print('시험 기존 Studio 완전 정지 후 신규 협조 잠금 보유 확인', flush=True)
blocked[0] = False
try:
    candidate.check()
except handoff_module.HandoffError:
    pass
else:
    raise RuntimeError('시험 직접 호출 차단 상실을 거절하지 못했습니다.')
if subprocess.run(['/usr/bin/python3', '-c', probe, str(path)], check=False).returncode != 42:
    raise RuntimeError('실패 후 시험 잠금이 해제됐습니다.')
print('모의 차단 상실 시 중단과 시험 잠금 유지 확인', flush=True)
# Disposable test only: release the retained descriptor after observing failure.
fence.release()
print('다른 직접 호출 차단·GPU 안전·신규 잠금 준비는 모의이며 운영 파일은 변경하지 않았습니다.', flush=True)
PY
systemctl stop "$unit"
rm -- "$unit_file"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture $tools"
