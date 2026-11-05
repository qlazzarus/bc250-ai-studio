#!/usr/bin/env python3
"""Copy a runner-authenticated candidate into a protected root-owned directory.

Internal candidate only. The caller must authenticate the identity tuple over
its independently trusted channel. This module does not authenticate SSH,
Actions, attestations, bootstrap code or operate services.
"""
import hashlib
import os
import re
import stat
from pathlib import Path

MAX_BYTES = 1024 * 1024 * 1024


def identity(info):
    return tuple(getattr(info, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def protected_directory(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('대상 경로가 올바르지 않습니다.')
    for current in (path, *path.parents):
        info = current.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or not stat.S_ISDIR(info.st_mode):
            raise ValueError('대상 디렉터리를 신뢰할 수 없습니다.')
    if path.stat().st_mode & 0o077:
        raise ValueError('대상 디렉터리는 root 전용이어야 합니다.')


def open_source(path, owner):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or path.name in ('', '.', '..'):
        raise ValueError('전송 경로가 올바르지 않습니다.')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for component in path.parts[1:-1]:
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            info = os.fstat(fd)
            if info.st_uid not in (0, owner) or info.st_mode & 0o022:
                raise ValueError('전송 경로 상위 디렉터리를 신뢰할 수 없습니다.')
        file_fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
        return fd, file_fd, path.name
    except BaseException:
        os.close(fd)
        raise


def receive(source, destination, *, owner, commit, digest, run_id, attempt, verify_authorization):
    if (os.geteuid() != 0 or type(owner) is not int or owner <= 0
            or not re.fullmatch(r'[0-9a-f]{40}', commit)
            or not re.fullmatch(r'[0-9a-f]{64}', digest)
            or not re.fullmatch(r'[1-9][0-9]*', run_id)
            or not re.fullmatch(r'[1-9][0-9]*', attempt)
            or not callable(verify_authorization)):
        raise ValueError('신뢰한 호출자와 릴리스 정보가 필요합니다.')
    if verify_authorization(commit, digest, run_id, attempt) is not True:
        raise ValueError('전달된 릴리스 승인이 확인되지 않았습니다.')
    protected_directory(destination)
    directory = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    parent = source_fd = -1
    try:
        for name in ('candidate.tar.gz', 'candidate.incomplete'):
            try:
                os.stat(name, dir_fd=directory, follow_symlinks=False)
            except FileNotFoundError:
                continue
            raise ValueError('기존 수신 파일이 있습니다. 기존 기록을 보존하세요.')
        parent, source_fd, name = open_source(source, owner)
        before = os.fstat(source_fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner or before.st_nlink != 1
                or before.st_mode & 0o022 or before.st_size <= 0 or before.st_size > MAX_BYTES):
            raise ValueError('전송 파일 소유권·형식·크기가 올바르지 않습니다.')
        output_fd = os.open('candidate.incomplete', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                            0o600, dir_fd=directory)
        with os.fdopen(output_fd, 'wb') as output, os.fdopen(source_fd, 'rb', closefd=False) as incoming:
            os.fchmod(output.fileno(), 0o600)
            sha = hashlib.sha256()
            count = 0
            while chunk := incoming.read(1024 * 1024):
                count += len(chunk)
                if count > MAX_BYTES:
                    raise ValueError('전송 파일 크기 제한 초과')
                sha.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if (count != before.st_size or sha.hexdigest() != digest
                or identity(before) != identity(os.fstat(source_fd))
                or identity(before) != identity(os.stat(name, dir_fd=parent, follow_symlinks=False))):
            raise ValueError('전송 파일 해시 또는 식별 정보가 다릅니다. 미완료 파일을 보존하세요.')
        if verify_authorization(commit, digest, run_id, attempt) is not True:
            raise ValueError('복사 중 릴리스 승인이 상실됐습니다. 미완료 파일을 보존하세요.')
        protected_directory(destination)
        opened_dir, current_dir = os.fstat(directory), os.stat(destination, follow_symlinks=False)
        if (opened_dir.st_dev, opened_dir.st_ino) != (current_dir.st_dev, current_dir.st_ino):
            raise ValueError('수신 디렉터리가 변경됐습니다.')
        os.link('candidate.incomplete', 'candidate.tar.gz', src_dir_fd=directory, dst_dir_fd=directory,
                follow_symlinks=False)
        os.fsync(directory)
        os.unlink('candidate.incomplete', dir_fd=directory)
        os.fsync(directory)
        return Path(destination) / 'candidate.tar.gz'
    finally:
        if source_fd >= 0:
            os.close(source_fd)
        if parent >= 0:
            os.close(parent)
        os.close(directory)
