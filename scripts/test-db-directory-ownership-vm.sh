#!/usr/bin/env bash
# Disposable files only; this observes access and is not a deployment fence.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
fixture=$(mktemp -d /var/lib/bc250-db-owner.XXXXXXXX)
trap 'echo "시험 중단. 시험 파일 보관: $fixture" >&2' ERR
chown ai-studio:ai-studio "$fixture"
chmod 0700 "$fixture"
install -o ai-studio -g ai-studio -m 0600 /dev/null "$fixture/probe"
restorecon -RF "$fixture"
python3 - "$fixture" <<'PY'
import os
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1])
child = r'''
import os, sys
path = sys.argv[1]
fd = os.open(path, os.O_RDWR)
print('ready', flush=True)
if sys.stdin.readline().strip() != 'continue': raise SystemExit(1)
try:
    fresh = os.open(path, os.O_RDWR)
except PermissionError:
    print('new-open-denied', flush=True)
else:
    os.close(fresh)
    print('new-open-allowed', flush=True)
try:
    os.pwrite(fd, b'x', 0)
except OSError:
    print('old-write-denied', flush=True)
else:
    print('old-write-allowed', flush=True)
os.close(fd)
'''
proc = subprocess.Popen(['/usr/sbin/runuser', '-u', 'ai-studio', '--', '/usr/bin/python3',
                         '-u', '-c', child, str(root / 'probe')],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
try:
    if proc.stdout.readline().strip() != 'ready':
        raise RuntimeError('시험 파일의 기존 FD 준비 실패')
    os.chown(root, 0, 0)
    os.chmod(root, 0o700)
    proc.stdin.write('continue\n')
    proc.stdin.flush()
    output, _ = proc.communicate(timeout=30)
    results = output.splitlines()
    if proc.returncode or len(results) != 2:
        raise RuntimeError('시험 프로세스 결과를 확인하지 못했습니다.')
    if results[0] not in {'new-open-denied', 'new-open-allowed'} or results[1] not in {'old-write-denied', 'old-write-allowed'}:
        raise RuntimeError('시험 결과 형식 오류')
    print('root 소유 시험 디렉터리 보호 후 새 파일 열기:', '거절' if results[0] == 'new-open-denied' else '허용', flush=True)
    print('보호 전 열린 시험 파일 FD 쓰기:', '거절' if results[1] == 'old-write-denied' else '허용', flush=True)
finally:
    if proc.poll() is None:
        proc.kill()
        proc.wait()
print('일반 시험 계정과 단일 파일만 관찰했으며 SQLite·다른 참조·지속 차단은 검증하지 않았습니다.', flush=True)
PY
trap - ERR
echo "시험 파일 보관: $fixture"
