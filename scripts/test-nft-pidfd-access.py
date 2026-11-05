#!/usr/bin/env python3
"""VM-only sibling-process probe; no access to any production process."""
import ctypes
import errno
import json
import os
import platform
import pwd
import select
import socket
import sys
from pathlib import Path

if (os.geteuid() != 0 or socket.gethostname() != 'bc250-fedora43-test'
        or platform.machine() != 'x86_64' or len(sys.argv) != 7):
    raise SystemExit('시험 VM의 root에서만 실행할 수 있습니다.')
group = Path(sys.argv[1])
uid, gid, caller_uid, caller_gid = map(int, sys.argv[2:6])
records = Path(sys.argv[6])
identities = {(pwd.getpwnam(name).pw_uid, pwd.getpwnam(name).pw_gid) for name in ('nobody', 'ai-gate', 'ai-studio')}
if (not group.is_absolute() or group.parent != Path('/sys/fs/cgroup')
        or not group.name.startswith('bc250_fd_') or (uid, gid) not in identities
        or (caller_uid, caller_gid) not in identities or not records.is_dir()):
    raise SystemExit('시험 cgroup 또는 계정이 올바르지 않습니다.')


def join(name, run_uid, run_gid):
    (group / name / 'cgroup.procs').write_text(str(os.getpid()) + '\n')
    os.setgroups([])
    os.setgid(run_gid)
    os.setuid(run_uid)
    if os.getuid() != run_uid or os.geteuid() != run_uid:
        raise RuntimeError('시험 프로세스 UID 전환 실패')
    status = (Path('/proc/self/status')).read_text(encoding='ascii')
    capabilities = next(line.split(':', 1)[1].strip() for line in status.splitlines()
                        if line.startswith('CapEff:'))
    if int(capabilities, 16) != 0:
        raise RuntimeError('시험 프로세스에 유효 capability가 남아 있습니다.')


ready_read, ready_write = os.pipe()
release_read, release_write = os.pipe()
result_read, result_write = os.pipe()
target = os.fork()
if target == 0:
    try:
        os.close(ready_read)
        os.close(release_write)
        join('gate', uid, gid)
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(4, 1, 0, 0, 0) != 0:  # PR_SET_DUMPABLE, as after a normal exec
            raise OSError(ctypes.get_errno(), 'prctl')
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as outgoing:
            os.write(ready_write, str(outgoing.fileno()).encode('ascii'))
            os.close(ready_write)
            readable, _, _ = select.select([release_read], [], [], 45)
            if not readable or os.read(release_read, 1) != b'x':
                raise RuntimeError('시험 소켓 유지 시간 초과')
        os._exit(0)
    except BaseException:
        os._exit(1)

os.close(ready_write)
os.close(release_read)
raw = os.read(ready_read, 32)
os.close(ready_read)
if not raw.isdigit():
    os.waitpid(target, 0)
    raise SystemExit('시험 소켓을 생성하지 못했습니다.')
target_fd = int(raw)
attacker = os.fork()
if attacker == 0:
    try:
        os.close(result_read)
        os.close(release_write)
        join('other', caller_uid, caller_gid)
        libc = ctypes.CDLL(None, use_errno=True)
        try:
            pidfd = os.pidfd_open(target, 0)
        except OSError as error:
            result = {'stage': 'pidfd_open', 'errno': error.errno}
        else:
            duplicate = libc.syscall(438, pidfd, target_fd, 0)  # x86_64 pidfd_getfd
            error_number = ctypes.get_errno() if duplicate < 0 else 0
            os.close(pidfd)
            if duplicate < 0:
                result = {'stage': 'pidfd_getfd', 'errno': error_number}
            else:
                with socket.socket(fileno=duplicate) as outgoing:
                    outgoing.settimeout(5)
                    result = {'stage': 'connect', 'errno': outgoing.connect_ex(('127.0.0.1', 18889))}
        os.write(result_write, json.dumps(result).encode('ascii'))
        os._exit(0)
    except BaseException:
        os._exit(1)

os.close(result_write)
readable, _, _ = select.select([result_read], [], [], 30)
raw_result = os.read(result_read, 1024) if readable else b''
os.close(result_read)
os.write(release_write, b'x')
os.close(release_write)
for pid in (target, attacker):
    _, status = os.waitpid(pid, 0)
    if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
        raise SystemExit('시험 프로세스가 완료되지 않았습니다.')
result = json.loads(raw_result)
stage, code = result.get('stage'), result.get('errno')
if stage in {'pidfd_open', 'pidfd_getfd'} and code in {errno.EPERM, errno.EACCES}:
    outcome = '복제 거절'
elif stage in {'pidfd_open', 'pidfd_getfd'} and code == errno.ENOSYS:
    outcome = '커널 기능 미지원'
elif stage == 'connect' and code == 0:
    outcome = '복제 후 연결 허용'
elif stage == 'connect' and code in {errno.ECONNREFUSED, errno.EACCES, errno.EPERM}:
    outcome = '복제 후 연결 거절'
else:
    raise SystemExit('예상하지 못한 시험 결과: ' + repr(result))
scope = Path('/proc/sys/kernel/yama/ptrace_scope')
result.update(outcome=outcome, ptrace_scope=scope.read_text().strip() if scope.exists() else '없음',
              same_uid=uid == caller_uid)
(records / 'pidfd-result.json').write_text(json.dumps(result, ensure_ascii=False) + '\n')
print('비협조 시험 프로세스의 pidfd 소켓 접근:', outcome, flush=True)
print('시험 VM ptrace_scope:', result['ptrace_scope'], flush=True)
