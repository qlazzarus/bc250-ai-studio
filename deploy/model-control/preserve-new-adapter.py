#!/usr/bin/env python3
"""Fail-stop new-service preservation adapter; no production entry point.

The coordinator must supply real maintenance, live-state and local-idle checks.
This adapter does not restore files, decide whether rollback is safe, or start
any service. A failed command must not be retried without inspecting state.
"""
import hashlib
import importlib.util
import os
import re
import stat
import subprocess
from pathlib import Path

SOCKET = 'bc250-model-worker.socket'
UNITS = ('bc250-model-api.service', 'bc250-model-worker.service',
         'bc250-llm-client.service', 'bc250-ai-studio.service', 'bc250-llm-gate.service')
SYSTEMD_EVIDENCE = frozenset({f'{unit}.status' for unit in (*UNITS, SOCKET, 'llama-server.service')}
                             | {'systemd-journal.log'})


def trusted_file(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('도구 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('도구 경로를 신뢰할 수 없습니다.')
        if item != path and not stat.S_ISDIR(info.st_mode):
            raise ValueError('도구 상위 경로가 디렉터리가 아닙니다.')
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError('도구가 단일 링크의 일반 파일이 아닙니다.')


class PreserveNewAdapter:
    def __init__(self, source, *, check_maintenance, inspect_live, check_local_idle):
        if (os.geteuid() != 0 or not all(callable(x) for x in
                (check_maintenance, inspect_live, check_local_idle))):
            raise ValueError('root와 유지보수·작업·유휴 검사기가 필요합니다.')
        self.source = Path(source)
        self.maintenance = check_maintenance
        self.inspect_live = inspect_live
        self.local_idle = check_local_idle
        for name in ('backup-archive.sh', 'check-service-cgroup.py',
                     'preserve-new-stopped.sh', 'preserve-new-archive.sh'):
            trusted_file(self.source / name)

    def inspect(self):
        return (self.maintenance() is True and self.inspect_live() is True
                and self.local_idle() is True)

    def stop(self):
        if not self.inspect():
            raise ValueError('신규 서비스 정지 전 상태가 확인되지 않았습니다.')
        for unit in (SOCKET, *UNITS):
            if self.maintenance() is not True:
                raise ValueError('서비스 정지 중 유지보수 상태를 확인하지 못했습니다.')
            subprocess.run(['/usr/bin/systemctl', 'stop', unit], check=True, timeout=1200)

    def require_stopped(self):
        if self.maintenance() is not True:
            raise ValueError('유지보수 상태를 확인하지 못했습니다.')
        trusted_file(self.source / 'backup-archive.sh')
        trusted_file(self.source / 'check-service-cgroup.py')
        subprocess.run(['/usr/bin/bash', '-c', 'source "$1"; shift; bc250_require_stopped "$@"',
                        'preserve-check', str(self.source / 'backup-archive.sh'), *UNITS],
                       check=True, timeout=120)
        result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', SOCKET,
                                 '-p', 'LoadState', '-p', 'ActiveState', '-p', 'Job'],
                                check=True, capture_output=True, text=True, timeout=10)
        properties = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
        if properties != {'LoadState': 'loaded', 'ActiveState': 'inactive', 'Job': ''}:
            raise ValueError('작업자 소켓의 정지를 확인하지 못했습니다.')

    def preserve(self):
        self.require_stopped()
        if self.local_idle() is not True:
            raise ValueError('상태 보존 전 로컬 유휴 상태를 확인하지 못했습니다.')
        for name in ('preserve-new-stopped.sh', 'preserve-new-archive.sh'):
            trusted_file(self.source / name)
        result = subprocess.run(['/usr/bin/bash', str(self.source / 'preserve-new-stopped.sh')],
                                check=True, capture_output=True, text=True, timeout=7200)
        paths = re.findall(r'^신규 상태 보존 경로: (/var/backups/bc250-model-postfailure\.[A-Za-z0-9]{8})$',
                           result.stdout, flags=re.MULTILINE)
        if len(paths) != 1:
            raise ValueError('신규 상태 보존 경로를 확인하지 못했습니다.')
        evidence = Path(paths[0])
        info = evidence.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError('신규 상태 보존 경로를 신뢰할 수 없습니다.')
        return evidence

    def recovery_safe(self, evidence, *, check_model):
        """Check preserved records and live prerequisites; not a rollback approval."""
        evidence = Path(evidence)
        if (not callable(check_model)
                or not re.fullmatch(r'/var/backups/bc250-model-postfailure\.[A-Za-z0-9]{8}', str(evidence))):
            raise ValueError('보존 경로 또는 모델 검사기가 올바르지 않습니다.')
        info = evidence.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError('신규 상태 보존 경로를 신뢰할 수 없습니다.')
        self.require_stopped()
        if self.local_idle() is not True:
            raise ValueError('로컬 호출과 GPU 유휴 상태가 확인되지 않았습니다.')
        manifest = evidence / 'SYSTEMD-SHA256SUMS'
        trusted_file(manifest)
        if stat.S_IMODE(manifest.stat().st_mode) != 0o600 or manifest.stat().st_size > 4096:
            raise ValueError('systemd 기록 체크섬 파일이 올바르지 않습니다.')
        hashes = {}
        for line in manifest.read_text(encoding='ascii').splitlines():
            match = re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9._-]+)', line)
            if not match or match[2] in hashes:
                raise ValueError('systemd 기록 체크섬 형식이 올바르지 않습니다.')
            hashes[match[2]] = match[1]
        if set(hashes) != SYSTEMD_EVIDENCE:
            raise ValueError('systemd 기록 목록이 올바르지 않습니다.')
        for name, digest in hashes.items():
            path = evidence / name
            trusted_file(path)
            if stat.S_IMODE(path.stat().st_mode) != 0o600:
                raise ValueError('systemd 기록 권한이 올바르지 않습니다.')
            with path.open('rb') as file:
                if hashlib.file_digest(file, 'sha256').hexdigest() != digest:
                    raise ValueError('systemd 기록 체크섬이 다릅니다.')
        checker = self.source / 'check-preserved-switch-state.py'
        state_checker = self.source / 'check-new-switch-state.py'
        trusted_file(checker)
        trusted_file(state_checker)
        spec = importlib.util.spec_from_file_location('preserved_switch_state', checker)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if module.check(evidence, state_checker) is not True or check_model() is not True:
            raise ValueError('보존 상태 또는 현재 모델을 확인하지 못했습니다.')
        self.require_stopped()
        if self.local_idle() is not True:
            raise ValueError('확인 중 로컬 유휴 상태가 변경됐습니다.')
        return True
