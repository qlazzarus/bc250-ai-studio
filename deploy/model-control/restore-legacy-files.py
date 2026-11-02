#!/usr/bin/env python3
"""Candidate file-set restoration primitive; no operational command.

The root coordinator must stop all writers, verify the legacy backup, preserve
new state, check recovery and block callers before invoking this function.
Failures retain every moved-aside path; this code never starts services.
"""

import hashlib
import os
import shutil
import stat
import subprocess
from pathlib import Path

REQUIRED = (
    'opt/bc250-ai-studio', 'opt/ai-studio-data',
    'etc/bc250-ai-studio.env', 'etc/bc250-llm-gate.env', 'etc/bc250-llm-client.env',
    'etc/systemd/system/bc250-ai-studio.service',
    'etc/systemd/system/bc250-llm-gate.service',
    'etc/systemd/system/bc250-llm-client.service',
)
OPTIONAL = (
    'etc/systemd/system/bc250-ai-studio.service.d',
    'etc/systemd/system/bc250-llm-gate.service.d',
    'etc/systemd/system/bc250-llm-client.service.d',
)
UNCHANGED = ('opt/ai/config/active-model.conf',
             'var/lib/bc250-model-control/legacy-pause.json')


def _attributes(path):
    return {name: os.getxattr(path, name, follow_symlinks=False)
            for name in os.listxattr(path, follow_symlinks=False)}


def _digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').digest()


def _same(source, target):
    """Compare contents, ownership, permissions, links and extended attributes."""
    a, b = source.lstat(), target.lstat()
    if ((a.st_mode, a.st_uid, a.st_gid) != (b.st_mode, b.st_uid, b.st_gid)
            or _attributes(source) != _attributes(target)):
        raise ValueError('복원 파일의 소유권·권한 또는 확장 속성이 다릅니다.')
    if stat.S_ISREG(a.st_mode):
        if a.st_size != b.st_size or _digest(source) != _digest(target):
            raise ValueError('복원 파일 내용이 다릅니다.')
    elif stat.S_ISLNK(a.st_mode):
        if os.readlink(source) != os.readlink(target):
            raise ValueError('복원 링크가 다릅니다.')
    elif stat.S_ISDIR(a.st_mode):
        names = {entry.name for entry in source.iterdir()}
        if names != {entry.name for entry in target.iterdir()}:
            raise ValueError('복원 디렉터리 내용이 다릅니다.')
        for name in names:
            _same(source / name, target / name)
    else:
        raise ValueError('지원하지 않는 백업 파일 형식입니다.')


def _trusted_directory(path, *, private=False):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('신뢰할 수 없는 경로입니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('경로 소유권 또는 권한이 올바르지 않습니다.')
    if private and path.stat().st_mode & 0o077:
        raise ValueError('복원 준비 디렉터리는 root 전용이어야 합니다.')


def restore(stage_files, live_root, displaced):
    """Restore the fixed legacy file set and preserve displaced objects.

    stage_files must be from a freshly verified backup and inaccessible to
    other users. displaced must be a new, empty, root-only directory on the
    same filesystem as every live parent. On failure, never assume an earlier
    rename was undone; retain displaced and inspect each path.
    """
    stage_files, live_root, displaced = map(Path, (stage_files, live_root, displaced))
    _trusted_directory(stage_files, private=True)
    _trusted_directory(live_root)
    _trusted_directory(displaced, private=True)
    if any(displaced.iterdir()):
        raise ValueError('기존 파일 보존 경로가 비어 있지 않습니다.')
    for name in UNCHANGED:
        _same(stage_files / name, live_root / name)
    for name in REQUIRED + OPTIONAL:
        source, target = stage_files / name, live_root / name
        _trusted_directory(target.parent)
        if target.parent.stat().st_dev != displaced.stat().st_dev:
            raise ValueError('기존 파일 보존 경로가 대상과 다른 파일 시스템입니다.')
        if name in REQUIRED and (not source.exists() or not target.exists()):
            raise ValueError('필수 복원 대상이 없습니다.')
        if source.is_symlink() or target.is_symlink():
            raise ValueError('최상위 복원 대상이 링크입니다.')
        if source.exists():
            info = source.lstat()
            wants_dir = name in REQUIRED[:2] or name in OPTIONAL
            if wants_dir != stat.S_ISDIR(info.st_mode):
                raise ValueError('복원 대상 형식이 다릅니다.')
            if not wants_dir and not stat.S_ISREG(info.st_mode):
                raise ValueError('복원 대상이 일반 파일이 아닙니다.')
        if target.exists():
            wants_dir = name in REQUIRED[:2] or name in OPTIONAL
            info = target.lstat()
            if wants_dir != stat.S_ISDIR(info.st_mode) or (not wants_dir and not stat.S_ISREG(info.st_mode)):
                raise ValueError('기존 대상 형식이 다릅니다.')
    prepared, old = displaced / 'prepared', displaced / 'displaced'
    prepared.mkdir(mode=0o700)
    old.mkdir(mode=0o700)
    for name in REQUIRED + OPTIONAL:
        source, copy = stage_files / name, prepared / name
        if source.exists():
            copy.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['/usr/bin/cp', '-a', '--', str(source), str(copy)], check=True)
            _same(source, copy)
    for name in REQUIRED + OPTIONAL:
        target, saved, copy = live_root / name, old / name, prepared / name
        if target.exists():
            saved.parent.mkdir(parents=True, exist_ok=True)
            os.rename(target, saved)
        if copy.exists():
            os.rename(copy, target)
            _same(stage_files / name, target)
        for parent in (target.parent, saved.parent):
            if parent.exists():
                fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
    for name in UNCHANGED:
        _same(stage_files / name, live_root / name)
    return displaced
