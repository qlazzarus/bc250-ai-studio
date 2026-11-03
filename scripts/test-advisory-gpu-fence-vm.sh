#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /var/lib/bc250-gpu-fence-test.XXXXXXXX)
tools=$(mktemp -d /opt/bc250-gpu-fence-test.XXXXXXXX)
chmod 0755 "$tools"
trap 'echo "시험 중단. 시험 파일과 잠금 상태 보존: $fixture $tools" >&2' ERR
install -o root -g root -m 0644 "$source_dir/deploy/model-control/advisory-gpu-fence.py" "$tools/advisory-gpu-fence.py"
restorecon -RF "$fixture" "$tools"
python3 - "$fixture" "$tools" <<'PY'
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

fixture, tools = map(Path, sys.argv[1:])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fixture_gpu_fence', tools / 'advisory-gpu-fence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
path = fixture / 'gpu.lock'
path.touch(mode=0o600)
fence = module.AdvisoryGPUFence(path, group_id=0)
probe = '''import fcntl, os, sys
fd = os.open(sys.argv[1], os.O_RDWR | os.O_NOFOLLOW)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit(42)
os.close(fd)
'''
def attempt(candidate):
    return subprocess.run(['/usr/bin/python3', '-c', probe, str(candidate)], check=False).returncode
if fence.acquire() is not True or fence.check() is not True or attempt(path) != 42:
    raise RuntimeError('시험 잠금 배타성 확인 실패')
print('시험 GPU 협조 잠금 보유 중 다른 프로세스의 획득 거절 확인', flush=True)
old = fixture / 'original.lock'
path.rename(old)
path.touch(mode=0o600)
try:
    fence.check()
except ValueError:
    pass
else:
    raise RuntimeError('시험 잠금 파일 교체를 거절하지 못했습니다.')
if attempt(old) != 42:
    raise RuntimeError('교체 감지 후 기존 시험 잠금이 유지되지 않았습니다.')
print('시험 잠금 경로 교체 거절과 기존 inode 잠금 유지 확인', flush=True)
fence.release()
if attempt(old) != 0:
    raise RuntimeError('시험 잠금 명시적 해제 확인 실패')
try:
    fence.check()
except ValueError:
    pass
else:
    raise RuntimeError('해제 후 보유 검사가 허용됐습니다.')
missing = module.AdvisoryGPUFence(fixture / 'absent.lock', group_id=0)
try:
    missing.acquire()
except FileNotFoundError:
    pass
else:
    raise RuntimeError('없는 시험 잠금을 만들거나 허용했습니다.')
print('시험 잠금 명시적 해제와 없는 파일 생성 거절 확인', flush=True)
print('이 잠금은 같은 inode에 협조하는 프로세스만 제한하며 실제 GPU 유휴나 직접 호출 차단은 보증하지 않습니다.', flush=True)
PY
echo "시험 파일 보관: $fixture $tools"
