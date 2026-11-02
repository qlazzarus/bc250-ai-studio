#!/usr/bin/env python3
"""Compare a root-owned staged tree to an independently pinned Actions artifact.

The expected artifact digest and commit must come from an authenticated Actions
run, not from files stored beside the artifact. The authenticated archive also
pins its own verification helper before that helper is imported. This class
performs no extraction, installation, service control, or network access.
"""
import hashlib
import importlib.util
import os
import re
import stat
import sys
import tarfile
from pathlib import Path, PurePosixPath

VERIFIER = 'deploy/model-control/verify-release-candidate.py'
MAX_FILES = 50000
MAX_BYTES = 1024 * 1024 * 1024


def trusted(path, *, directory=False):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('릴리스 경로가 정규화되지 않았습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('릴리스 경로를 신뢰할 수 없습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('릴리스 디렉터리가 아닙니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('릴리스 파일이 단일 링크의 일반 파일이 아닙니다.')


def identity(info):
    return tuple(getattr(info, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def sha256(file):
    return hashlib.file_digest(file, 'sha256').hexdigest()


def check_tree_entry(path):
    info = path.lstat()
    if (info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode)
            or not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode))
            or (stat.S_ISREG(info.st_mode) and info.st_nlink != 1)):
        raise ValueError('스테이징된 릴리스에 신뢰할 수 없는 항목이 있습니다.')


class StagedReleaseCheck:
    def __init__(self, archive, root, expected_commit, expected_sha256):
        self.archive, self.root = Path(archive), Path(root)
        self.commit, self.digest = expected_commit, expected_sha256
        if (os.geteuid() != 0 or not re.fullmatch(r'[0-9a-f]{40}', self.commit)
                or not re.fullmatch(r'[0-9a-f]{64}', self.digest)):
            raise ValueError('root와 인증된 커밋·아티팩트 해시가 필요합니다.')

    def __call__(self, commit, artifact_sha256):
        if commit != self.commit or artifact_sha256 != self.digest:
            raise ValueError('릴리스 식별 정보가 다릅니다.')
        trusted(self.archive)
        trusted(self.root, directory=True)
        verifier_path = self.root / VERIFIER
        trusted(verifier_path)
        fd = os.open(self.archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        with os.fdopen(fd, 'rb') as file:
            before = os.fstat(file.fileno())
            if sha256(file) != self.digest:
                raise ValueError('아티팩트 해시가 다릅니다.')
            file.seek(0)
            with tarfile.open(fileobj=file, mode='r:gz') as archive:
                matches = [entry for entry in archive if entry.name.rstrip('/') == VERIFIER]
                if len(matches) != 1 or not matches[0].isfile() or matches[0].size > 1024 * 1024:
                    raise ValueError('인증된 아티팩트의 검사기가 올바르지 않습니다.')
                expected_verifier = sha256(archive.extractfile(matches[0]))
            with verifier_path.open('rb') as verifier_file:
                before_verifier = os.fstat(verifier_file.fileno())
                if sha256(verifier_file) != expected_verifier:
                    raise ValueError('스테이징된 아티팩트 검사기가 다릅니다.')
            # Do not create pycache files in the immutable staged tree.
            spec = importlib.util.spec_from_file_location('pinned_release_verifier', verifier_path)
            module = importlib.util.module_from_spec(spec)
            previous = sys.dont_write_bytecode
            try:
                sys.dont_write_bytecode = True
                spec.loader.exec_module(module)
            finally:
                sys.dont_write_bytecode = previous
            if identity(verifier_path.stat()) != identity(before_verifier):
                raise ValueError('검사기 로딩 중 파일이 변경됐습니다.')
            module.verify(self.archive, self.digest, self.commit)
            file.seek(0)
            expected = set()
            total = 0
            with tarfile.open(fileobj=file, mode='r:gz') as archive:
                for count, entry in enumerate(archive, 1):
                    name = entry.name.rstrip('/')
                    parts = name.split('/')
                    if (count > MAX_FILES or not name or name.startswith('/')
                            or any(part in ('', '.', '..') for part in parts)
                            or not (entry.isfile() or entry.isdir()) or name in expected):
                        raise ValueError('아티팩트 경로 또는 형식이 올바르지 않습니다.')
                    expected.add(name)
                    target = self.root.joinpath(*PurePosixPath(name).parts)
                    trusted(target, directory=entry.isdir())
                    if entry.isfile():
                        total += entry.size
                        if total > MAX_BYTES or target.stat().st_size != entry.size:
                            raise ValueError('릴리스 파일 크기가 다릅니다.')
                        with target.open('rb') as local, archive.extractfile(entry) as incoming:
                            local_before = os.fstat(local.fileno())
                            if sha256(local) != sha256(incoming):
                                raise ValueError('스테이징된 릴리스 파일이 아티팩트와 다릅니다.')
                            if identity(local_before) != identity(os.fstat(local.fileno())):
                                raise ValueError('릴리스 검사 중 파일이 변경됐습니다.')
            found = set()
            for parent, dirs, files in os.walk(self.root, followlinks=False, onerror=lambda e: (_ for _ in ()).throw(e)):
                for name in dirs + files:
                    path = Path(parent) / name
                    relative = path.relative_to(self.root).as_posix()
                    check_tree_entry(path)
                    found.add(relative)
            # Tar archives may omit explicit directory entries; allow only
            # parents of authenticated members, never unrelated extra files.
            parents = {str(parent) for name in expected for parent in PurePosixPath(name).parents if str(parent) != '.'}
            if found != expected | parents:
                raise ValueError('스테이징된 릴리스의 파일 목록이 다릅니다.')
            if identity(before) != identity(os.fstat(file.fileno())):
                raise ValueError('검사 중 아티팩트가 변경됐습니다.')
            trusted(self.archive)
            if identity(before) != identity(self.archive.stat()):
                raise ValueError('검사 중 아티팩트 경로가 변경됐습니다.')
        return True
