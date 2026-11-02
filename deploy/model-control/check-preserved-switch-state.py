#!/usr/bin/env python3
"""Inspect switch state inside a root-private evidence archive; no CLI.

Only fixed regular files are copied to a private temporary directory. The
archive is never extracted onto live paths. This is one rollback prerequisite,
not a complete rollback authorization.
"""

import hashlib
import importlib.util
import os
import shutil
import stat
import tarfile
import tempfile
from pathlib import Path

REQUIRED = frozenset({'var/lib/bc250-model-control/switch.json',
                      'var/lib/bc250-model-control/operations.sqlite3',
                      'var/lib/bc250-llm-gate/holds.json'})
OPTIONAL = frozenset({'var/lib/bc250-model-control/operations.sqlite3-wal',
                      'var/lib/bc250-model-control/operations.sqlite3-shm'})
MAX_FILE = 1024 * 1024 * 1024


def trusted(path, *, directory):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('보존 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('보존 경로 소유권 또는 권한이 올바르지 않습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('보존 디렉터리가 올바르지 않습니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('보존 파일이 단일 링크의 일반 파일이 아닙니다.')


def check(evidence, checker_path):
    evidence, checker_path = Path(evidence), Path(checker_path)
    trusted(evidence, directory=True)
    trusted(checker_path, directory=False)
    if evidence.stat().st_mode & 0o077:
        raise ValueError('보존 디렉터리는 root 전용이어야 합니다.')
    archive_path = evidence / 'new-state.tar'
    checksum_path = evidence / 'NEW-STATE-SHA256SUMS'
    for path in (archive_path, checksum_path):
        trusted(path, directory=False)
        if path.stat().st_mode & 0o077:
            raise ValueError('보존 파일은 root 전용이어야 합니다.')
    if checksum_path.stat().st_size != 80:
        raise ValueError('보존 아카이브 체크섬 형식이 다릅니다.')
    manifest = checksum_path.read_text(encoding='ascii')
    if len(manifest) != 80 or manifest[64:] != '  new-state.tar\n':
        raise ValueError('보존 아카이브 체크섬 형식이 다릅니다.')
    digest = manifest[:64]
    if any(c not in '0123456789abcdef' for c in digest):
        raise ValueError('보존 아카이브 체크섬 형식이 다릅니다.')
    spec = importlib.util.spec_from_file_location('preserved_switch_check', checker_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with archive_path.open('rb') as source, tempfile.TemporaryDirectory(prefix='bc250-state-review-') as temp:
        before = os.fstat(source.fileno())
        if hashlib.file_digest(source, 'sha256').hexdigest() != digest:
            raise ValueError('보존 아카이브 체크섬이 다릅니다.')
        source.seek(0)
        found = set()
        with tarfile.open(fileobj=source, mode='r:') as archive:
            for item in archive:
                name = item.name.rstrip('/')
                if name not in REQUIRED | OPTIONAL:
                    continue
                if name in found or not item.isfile() or item.size > MAX_FILE:
                    raise ValueError('보존 상태 항목이 중복됐거나 올바르지 않습니다.')
                found.add(name)
                destination = Path(temp) / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(item) as incoming, destination.open('xb') as output:
                    shutil.copyfileobj(incoming, output, length=1024 * 1024)
        if not REQUIRED.issubset(found):
            raise ValueError('보존된 전환 상태 파일이 없습니다.')
        after = os.fstat(source.fileno())
        fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        if any(getattr(before, field) != getattr(after, field) for field in fields):
            raise ValueError('검사 중 보존 아카이브가 변경됐습니다.')
        return module.check(Path(temp) / 'var/lib/bc250-model-control',
                            Path(temp) / 'var/lib/bc250-llm-gate')
