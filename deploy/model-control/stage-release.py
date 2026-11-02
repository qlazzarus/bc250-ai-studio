#!/usr/bin/env python3
"""Stage an independently authenticated artifact into a new /opt directory.

Internal primitive only: a trusted coordinator supplies authenticated commit
and digest plus real archive and staged-tree verifiers. No service is stopped
or started. Failure leaves any partial tree intact and cannot be retried over
the same destination.
"""
import hashlib
import os
import re
import stat
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

MAX_FILES = 50000
MAX_BYTES = 1024 * 1024 * 1024


def trusted(path, *, directory=False):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('아티팩트 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('아티팩트 경로를 신뢰할 수 없습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('아티팩트 디렉터리가 올바르지 않습니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('아티팩트는 단일 링크의 일반 파일이어야 합니다.')


def identity(info):
    return tuple(getattr(info, name) for name in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def ensure_directory(root, directory):
    current = root
    for part in directory.relative_to(root).parts:
        current = current / part
        try:
            os.mkdir(current, 0o755)
        except FileExistsError:
            info = current.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_ISLNK(info.st_mode):
                raise ValueError('스테이징 디렉터리가 올바르지 않습니다.') from None
        os.chmod(current, 0o755)


def stage(archive, destination, commit, digest, *, verify_archive, verify_stage):
    archive, destination = Path(archive), Path(destination)
    if (os.geteuid() != 0 or not callable(verify_archive) or not callable(verify_stage)
            or not re.fullmatch(r'[0-9a-f]{40}', commit)
            or not re.fullmatch(r'[0-9a-f]{64}', digest)
            or not re.fullmatch(r'/opt/bc250-release\.[A-Za-z0-9]{8}', str(destination))):
        raise ValueError('root, 인증된 릴리스 정보와 신규 대상이 필요합니다.')
    trusted(archive)
    trusted(destination.parent, directory=True)
    if destination.exists() or destination.is_symlink():
        raise ValueError('릴리스 대상이 이미 있습니다. 기존 상태를 보존하세요.')
    fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as artifact:
        before = os.fstat(artifact.fileno())
        if hashlib.file_digest(artifact, 'sha256').hexdigest() != digest:
            raise ValueError('아티팩트 해시가 다릅니다.')
        if verify_archive(archive, digest, commit) is not True:
            raise ValueError('아티팩트 검증에 실패했습니다.')
        if identity(before) != identity(os.fstat(artifact.fileno())) or identity(before) != identity(archive.lstat()):
            raise ValueError('검증 중 아티팩트가 변경됐습니다.')
        os.mkdir(destination, 0o755)
        os.chmod(destination, 0o755)
        sync_directory(destination.parent)
        artifact.seek(0)
        seen, total = set(), 0
        with tarfile.open(fileobj=artifact, mode='r:gz') as stream:
            for count, member in enumerate(stream, 1):
                name = member.name.rstrip('/')
                parts = name.split('/')
                if (count > MAX_FILES or not name or name.startswith('/') or name in seen or member.size < 0
                        or any(part in ('', '.', '..') for part in parts)
                        or not (member.isfile() or member.isdir())):
                    raise ValueError('아티팩트의 경로 또는 파일 형식이 올바르지 않습니다.')
                seen.add(name)
                path = destination.joinpath(*PurePosixPath(name).parts)
                if member.isdir():
                    ensure_directory(destination, path)
                    continue
                total += member.size
                if total > MAX_BYTES:
                    raise ValueError('아티팩트의 압축 해제 크기가 너무 큽니다.')
                ensure_directory(destination, path.parent)
                file_fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                                  0o755 if member.mode & 0o111 else 0o644)
                with os.fdopen(file_fd, 'wb') as out, stream.extractfile(member) as incoming:
                    os.fchmod(out.fileno(), 0o755 if member.mode & 0o111 else 0o644)
                    remaining = member.size
                    while remaining:
                        chunk = incoming.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise ValueError('아티팩트 파일이 중간에 끝났습니다.')
                        out.write(chunk)
                        remaining -= len(chunk)
                    out.flush()
                    os.fsync(out.fileno())
        for parent, dirs, _ in os.walk(destination, topdown=False, followlinks=False):
            for name in dirs:
                sync_directory(Path(parent) / name)
        sync_directory(destination)
        subprocess.run(['/usr/sbin/restorecon', '-RF', str(destination)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
        if identity(before) != identity(os.fstat(artifact.fileno())) or identity(before) != identity(archive.lstat()):
            raise ValueError('스테이징 중 아티팩트가 변경됐습니다.')
        if verify_stage(destination, commit, digest) is not True:
            raise ValueError('스테이징된 릴리스 검증에 실패했습니다.')
        return destination
