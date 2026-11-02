#!/usr/bin/env python3
"""Candidate first-install file installer; no service control or CLI.

Call only after quiescence and a verified backup. The source must be a trusted,
root-owned and independently verified release. A partial installation is not
automatically removed; its private manifest and installed files are retained.
"""

import hashlib
import json
import os
import stat
import subprocess
from pathlib import Path

FILES = {
    'deploy/model-control/studio.conf': 'etc/systemd/system/bc250-ai-studio.service.d/50-model-control.conf',
    'deploy/model-control/gate.conf': 'etc/systemd/system/bc250-llm-gate.service.d/50-model-control.conf',
    'deploy/model-control/llm-client.conf': 'etc/systemd/system/bc250-llm-client.service.d/50-model-control.conf',
    'deploy/model-control/50-bc250-studio-llm.rules': 'etc/polkit-1/rules.d/50-bc250-studio-llm.rules',
    'systemd/bc250-gpu-lock.conf': 'etc/tmpfiles.d/bc250-gpu-lock.conf',
    'systemd/bc250-model-worker.socket': 'etc/systemd/system/bc250-model-worker.socket',
    'systemd/bc250-model-worker.service': 'etc/systemd/system/bc250-model-worker.service',
    'systemd/bc250-model-api.service': 'etc/systemd/system/bc250-model-api.service',
}
DROPINS = frozenset(value.rsplit('/', 1)[0] for value in list(FILES.values())[:3])


def trusted(path, *, directory):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('설치 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('설치 경로 소유권 또는 권한이 올바르지 않습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('설치 상위 경로가 디렉터리가 아닙니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('릴리스 파일이 단일 링크의 일반 파일이 아닙니다.')


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def install(source, live_root, manifest_dir):
    """Install only absent files and record their pre-install absence.

    live_root is '/' for production and a private directory in VM tests.
    The caller controls services, tmpfiles and daemon-reload separately.
    """
    source, live_root, manifest_dir = map(Path, (source, live_root, manifest_dir))
    if os.geteuid() != 0:
        raise ValueError('root가 필요합니다.')
    trusted(source, directory=True)
    trusted(live_root, directory=True)
    trusted(manifest_dir, directory=True)
    if manifest_dir.stat().st_mode & 0o077:
        raise ValueError('설치 기록 디렉터리는 root 전용이어야 합니다.')
    payloads = {}
    created_dirs = []
    for src, dst in FILES.items():
        source_file = source / src
        trusted(source_file, directory=False)
        if source_file.stat().st_size > 1024 * 1024:
            raise ValueError('릴리스 설정 파일이 너무 큽니다.')
        payloads[dst] = source_file.read_bytes()
        target = live_root / dst
        if target.exists() or target.is_symlink():
            raise ValueError('설치할 대상이 이미 존재합니다: ' + dst)
        parent = target.parent
        if parent.exists():
            trusted(parent, directory=True)
        elif str(parent.relative_to(live_root)) in DROPINS:
            trusted(parent.parent, directory=True)
            if parent.is_symlink():
                raise ValueError('drop-in 경로가 링크입니다.')
            created_dirs.append(str(parent.relative_to(live_root)))
        else:
            raise ValueError('필수 설치 상위 경로가 없습니다.')
    manifest = {'version': 1, 'files': {name: hashlib.sha256(data).hexdigest()
                                         for name, data in payloads.items()},
                'absent_before_install': sorted(payloads),
                'created_directories': sorted(set(created_dirs))}
    manifest_path = manifest_dir / 'new-unit-install.json'
    fd = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as file:
        json.dump(manifest, file, sort_keys=True)
        file.write('\n')
        file.flush()
        os.fsync(file.fileno())
    sync_dir(manifest_dir)
    for directory in sorted(set(created_dirs)):
        target = live_root / directory
        os.mkdir(target, 0o755)
        os.chmod(target, 0o755)
        subprocess.run(['/usr/sbin/restorecon', '-F', str(target)], check=True)
        sync_dir(target.parent)
    for name, content in payloads.items():
        target = live_root / name
        trusted(target.parent, directory=True)
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(fd, 'wb') as file:
            os.fchmod(file.fileno(), 0o644)
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        subprocess.run(['/usr/sbin/restorecon', '-F', str(target)], check=True)
        if target.read_bytes() != content or stat.S_IMODE(target.stat().st_mode) != 0o644:
            raise ValueError('설치된 파일을 확인하지 못했습니다.')
        fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        sync_dir(target.parent)
    return manifest_path
