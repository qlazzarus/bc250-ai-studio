#!/usr/bin/env python3
"""Root-owned Caddy maintenance adapter candidate; no operational CLI.

Call only from a trusted coordinator that blocks local callers and verifies
normal responses. An uncertain reload result is never retried automatically.
"""
import importlib.util
import os
import stat
import subprocess
from pathlib import Path

CADDY = Path('/usr/bin/caddy')
CADDYFILE = Path('/etc/caddy/Caddyfile')
SERVICE = 'caddy.service'


def trusted(path, *, directory=False):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Caddy 도구 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('Caddy 도구 경로를 신뢰할 수 없습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('Caddy 도구 디렉터리가 올바르지 않습니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('Caddy 도구가 단일 링크의 일반 파일이 아닙니다.')


def load(name, path):
    trusted(path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def service_ready():
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', SERVICE,
                             '-p', 'LoadState', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'Job'],
                            check=True, capture_output=True, text=True, timeout=10)
    data = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if (data.get('LoadState') != 'loaded' or data.get('ActiveState') != 'active'
            or data.get('Job') != '' or not data.get('MainPID', '').isdigit()
            or int(data['MainPID']) <= 1):
        raise ValueError('실행 중인 Caddy 서비스를 확인하지 못했습니다.')


class CaddyMaintenanceAdapter:
    def __init__(self, source, snapshot, *, check_local_idle, check_restored):
        if os.geteuid() != 0 or not callable(check_local_idle) or not callable(check_restored):
            raise ValueError('root와 로컬 유휴·정상 응답 검사기가 필요합니다.')
        self.source, self.snapshot = Path(source), Path(snapshot)
        trusted(self.source, directory=True)
        trusted(self.snapshot, directory=True)
        if self.snapshot.stat().st_mode & 0o077:
            raise ValueError('Caddy 보관 경로는 root 전용이어야 합니다.')
        self.local_idle, self.restored = check_local_idle, check_restored
        self.capture = load('caddy_capture', self.source / 'capture-caddy.py')
        self.swap = load('caddy_swap', self.source / 'caddy-file-swap.py')
        self.transaction = load('caddy_transaction', self.source / 'caddy-transaction.py')
        self.maintenance = load('caddy_probe', self.source / 'maintenance-probe.py')
        self.generator = self.source / 'create-maintenance-caddy.py'
        trusted(self.generator)

    def validate(self, path):
        trusted(CADDY)
        trusted(path)
        subprocess.run([str(CADDY), 'validate', '--config', str(path), '--adapter', 'caddyfile'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)

    def reload(self, path):
        if path != CADDYFILE:
            raise ValueError('예상하지 않은 Caddy 설정 경로입니다.')
        subprocess.run(['/usr/bin/systemctl', 'reload', SERVICE], check=True, timeout=120)

    def probe(self):
        try:
            return self.maintenance.probe()
        except (OSError, ValueError, RuntimeError):
            if self.restored() is True:
                return False
            raise ValueError('Caddy 유지보수 또는 정상 응답을 확인하지 못했습니다.') from None

    def transition(self, mode):
        trusted(CADDY)
        trusted(CADDYFILE)
        service_ready()
        if self.local_idle() is not True:
            raise ValueError('Caddy 변경 전 로컬 유휴 상태를 확인하지 못했습니다.')
        self.transaction.transition(mode=mode, snapshot=self.snapshot, live=CADDYFILE,
                                    generator=self.generator, capture=self.capture,
                                    swap=self.swap.swap, validate=self.validate,
                                    reload=self.reload, probe=self.probe)
