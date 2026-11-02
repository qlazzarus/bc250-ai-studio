#!/usr/bin/env python3
"""Read-only verification of a completed legacy backup before further review."""

import hashlib
import os
import stat
import sys
import tarfile
from pathlib import Path, PurePosixPath

REQUIRED = frozenset({
    'opt/bc250-ai-studio', 'opt/ai-studio-data', 'etc/bc250-ai-studio.env',
    'etc/bc250-llm-gate.env', 'etc/bc250-llm-client.env',
    'etc/systemd/system/bc250-ai-studio.service',
    'etc/systemd/system/bc250-llm-gate.service',
    'etc/systemd/system/bc250-llm-client.service',
    'opt/ai/config/active-model.conf', 'var/lib/bc250-model-control/legacy-pause.json',
})
OPTIONAL_TREES = frozenset({
    'etc/systemd/system/bc250-ai-studio.service.d',
    'etc/systemd/system/bc250-llm-gate.service.d',
    'etc/systemd/system/bc250-llm-client.service.d',
})
TREES = ('opt/bc250-ai-studio/', 'opt/ai-studio-data/',
         *(name + '/' for name in sorted(OPTIONAL_TREES)))


def trusted_backup(path):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('백업 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('신뢰할 수 없는 백업 디렉터리입니다.')
    if path.stat().st_mode & 0o077:
        raise ValueError('백업 디렉터리가 root 전용이 아닙니다.')


def checked_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    file = os.fdopen(fd, 'rb')
    info = os.fstat(fd)
    forbidden = 0o022 if path.name == 'Caddyfile.original' else 0o077
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or
            info.st_nlink != 1 or info.st_mode & forbidden):
        file.close()
        raise ValueError('신뢰할 수 없는 백업 파일입니다.')
    return file


def verify_checksums(directory):
    with checked_file(directory / 'SHA256SUMS') as file:
        content = file.read(1025)
    if len(content) > 1024:
        raise ValueError('체크섬 파일이 너무 큽니다.')
    lines = content.decode('ascii').splitlines()
    expected = {}
    for line in lines:
        digest, separator, name = line.partition('  ')
        if (not separator or name not in {'legacy.tar', 'Caddyfile.original'} or
                name in expected or len(digest) != 64 or
                any(char not in '0123456789abcdef' for char in digest)):
            raise ValueError('체크섬 목록이 올바르지 않습니다.')
        expected[name] = digest
    if set(expected) != {'legacy.tar', 'Caddyfile.original'}:
        raise ValueError('체크섬 목록이 불완전합니다.')
    for name, digest in expected.items():
        with checked_file(directory / name) as file:
            actual = hashlib.file_digest(file, 'sha256').hexdigest()
        if actual != digest:
            raise ValueError('백업 파일의 체크섬이 다릅니다.')


def archive_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or not path.parts:
        raise ValueError('아카이브 경로가 올바르지 않습니다.')
    name = str(path)
    if name not in REQUIRED and name not in OPTIONAL_TREES and not name.startswith(TREES):
        raise ValueError('예상하지 않은 아카이브 경로가 있습니다.')
    return name


def verify_archive(directory):
    names, symlinks, hardlinks, regular_files = set(), set(), [], set()
    with checked_file(directory / 'legacy.tar') as file, tarfile.open(fileobj=file, mode='r:') as archive:
        for member in archive:
            name = archive_name(member.name)
            if name in names or not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError('중복 또는 지원하지 않는 아카이브 항목이 있습니다.')
            if member.issym() and any(name.startswith(root + '/') for root in OPTIONAL_TREES):
                raise ValueError('drop-in 심볼릭 링크는 지원하지 않습니다.')
            if name in {'opt/bc250-ai-studio', 'opt/ai-studio-data'} | OPTIONAL_TREES:
                if not member.isdir():
                    raise ValueError('백업 디렉터리 항목의 형식이 올바르지 않습니다.')
            elif name in REQUIRED and not member.isfile():
                raise ValueError('필수 백업 파일의 형식이 올바르지 않습니다.')
            names.add(name)
            if member.issym():
                symlinks.add(name)
            elif member.islnk():
                hardlinks.append(archive_name(member.linkname))
            elif member.isfile():
                regular_files.add(name)
    if not REQUIRED.issubset(names) or not set(hardlinks).issubset(regular_files):
        raise ValueError('아카이브 대상이 누락됐습니다.')
    if any(name.startswith(root + '/') and root not in names
           for root in OPTIONAL_TREES for name in names):
        raise ValueError('drop-in 디렉터리 항목이 누락됐습니다.')
    if any(any(parent.as_posix() in symlinks for parent in PurePosixPath(name).parents)
           for name in names):
        raise ValueError('심볼릭 링크 내부에 아카이브 항목이 있습니다.')


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise SystemExit('root로 백업 디렉터리 하나를 전달하세요.')
    try:
        directory = Path(sys.argv[1])
        trusted_backup(directory)
        verify_checksums(directory)
        verify_archive(directory)
    except (OSError, ValueError, UnicodeError, tarfile.TarError):
        raise SystemExit('백업 검증 실패: 백업을 보존하고 원인을 확인하세요.') from None
    print('백업 경로, 체크섬 및 아카이브 대상 확인 완료')
    print('이 검사는 데이터 일관성이나 서비스 복원을 보증하지 않습니다.')


if __name__ == '__main__':
    main()
