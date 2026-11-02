#!/usr/bin/env python3
"""Fail-stop first-install adapter; no standalone deployment command.

It only runs after a verified legacy backup. The caller supplies real release,
configuration, maintenance and local-idle checks. Failed partial installations
are retained for explicit recovery; this code does not start services or switch
models.
"""
import importlib.util
import os
import re
import stat
import subprocess
from pathlib import Path

LEGACY_UNITS = ('bc250-ai-studio.service', 'bc250-llm-client.service', 'bc250-llm-gate.service')
LIVE_ROOT = Path('/')
STUDIO = Path('/opt/bc250-ai-studio')
SNAPSHOT = Path('/var/lib/bc250-model-control/legacy-pause.json')
GATE_DIR = Path('/var/lib/bc250-llm-gate')


def trusted(path, *, directory=False, private=False):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('설치 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('설치 경로를 신뢰할 수 없습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('설치 디렉터리가 올바르지 않습니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('설치 도구가 단일 링크의 일반 파일이 아닙니다.')
    if private and stat.S_IMODE(path.stat().st_mode) != 0o700:
        raise ValueError('설치 기록 경로는 root 전용이어야 합니다.')


def load(name, path):
    trusted(path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InitialInstallAdapter:
    def __init__(self, release, displaced, cache, manifest_dir, *, check_release,
                 check_configuration, check_maintenance, check_local_idle, offline=False):
        if (os.geteuid() != 0 or type(offline) is not bool or not all(callable(x) for x in
                (check_release, check_configuration, check_maintenance, check_local_idle))):
            raise ValueError('root와 필수 설치 검사기가 필요합니다.')
        self.release, self.displaced, self.cache, self.manifest_dir = map(
            Path, (release, displaced, cache, manifest_dir))
        self.check_release, self.check_configuration = check_release, check_configuration
        self.check_maintenance, self.check_local_idle = check_maintenance, check_local_idle
        self.offline = offline
        trusted(self.release, directory=True)
        for path in (self.displaced, self.cache, self.manifest_dir):
            trusted(path, directory=True, private=True)
        self.source = self.release / 'deploy/model-control'
        self.migration = load('initial_gate_migration', self.source / 'migrate-legacy-gate.py')
        self.studio = load('initial_studio_install', self.source / 'install-studio-release.py')
        self.units = load('initial_unit_install', self.source / 'install-units.py')
        self.compare = load('initial_restore_compare', self.source / 'restore-legacy-files.py')
        for name in ('backup-archive.sh', 'check-service-cgroup.py', 'verify-backup.py'):
            trusted(self.source / name)

    def ready(self, backup):
        if (self.check_release() is not True or self.check_configuration() is not True
                or self.check_maintenance() is not True or self.check_local_idle() is not True):
            raise ValueError('릴리스·설정·유지보수 또는 로컬 유휴 상태가 확인되지 않았습니다.')
        if not re.fullmatch(r'/var/backups/bc250-model-migration\.[A-Za-z0-9]{8}', str(backup)):
            raise ValueError('백업 경로가 올바르지 않습니다.')
        trusted(backup, directory=True, private=True)
        for name in ('backup-archive.sh', 'check-service-cgroup.py', 'verify-backup.py'):
            trusted(self.source / name)
        subprocess.run(['/usr/bin/bash', '-c', 'source "$1"; shift; bc250_require_stopped "$@"',
                        'initial-install', str(self.source / 'backup-archive.sh'), *LEGACY_UNITS],
                       check=True, timeout=120)
        subprocess.run(['/usr/bin/python3', '-I', str(self.source / 'verify-backup.py'), str(backup)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=7200)
        return True

    def __call__(self, backup):
        backup = Path(backup)
        self.ready(backup)
        trusted(SNAPSHOT)
        if GATE_DIR.exists() or GATE_DIR.is_symlink():
            raise ValueError('새 gate 상태가 이미 존재합니다. 기존 상태를 보존하세요.')
        self.migration.create_state(SNAPSHOT, GATE_DIR)
        # Only newly created state is relabelled; active-model.conf is untouched.
        subprocess.run(['/usr/sbin/restorecon', '-RF', str(GATE_DIR)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        self.ready(backup)
        self.studio.install(self.release, STUDIO, self.displaced, self.cache,
                            check_ready=lambda: self.ready(backup),
                            compare=self.compare._same, offline=self.offline)
        self.ready(backup)
        self.units.install(self.release, LIVE_ROOT, self.manifest_dir)
        self.ready(backup)
        return True
