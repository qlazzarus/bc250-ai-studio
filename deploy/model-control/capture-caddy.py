#!/usr/bin/env python3
"""Capture a reviewed Caddyfile and generate a candidate without applying it."""

import hashlib
import importlib.util
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path


def trusted(path, *, directory):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('신뢰할 수 없는 경로입니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('경로 소유권 또는 권한이 올바르지 않습니다.')
        expected_dir = item != path or directory
        if expected_dir != stat.S_ISDIR(info.st_mode):
            raise ValueError('경로 형식이 올바르지 않습니다.')
    info = path.lstat()
    if not directory and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
        raise ValueError('원본은 단일 링크의 일반 파일이어야 합니다.')


def metadata(path):
    info = path.stat(follow_symlinks=False)
    attrs = {key: os.getxattr(path, key, follow_symlinks=False)
             for key in os.listxattr(path, follow_symlinks=False)}
    return (info.st_uid, info.st_gid, info.st_mode, attrs)


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def candidate_module(generator):
    trusted(generator, directory=False)
    spec = importlib.util.spec_from_file_location('caddy_candidate', generator)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def capture(source, base, generator):
    trusted(source, directory=False)
    trusted(base, directory=True)
    module = candidate_module(generator)
    before = source.lstat()
    original_hash = digest(source)
    original_metadata = metadata(source)
    result = module.candidate(source.read_text(encoding='utf-8'))
    directory = Path(tempfile.mkdtemp(prefix='bc250-caddy-snapshot.', dir=base))
    os.chmod(directory, 0o700)
    print('Caddy 시험 또는 보관 경로:', directory, flush=True)
    original = directory / 'Caddyfile.original'
    candidate = directory / 'Caddyfile.maintenance'
    shutil.copy2(source, original, follow_symlinks=False)
    if original_metadata != metadata(original) or original_hash != digest(original):
        raise ValueError('Caddy 원본 백업의 내용 또는 메타데이터가 다릅니다.')
    after = source.lstat()
    if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
            or original_metadata != metadata(source) or original_hash != digest(source)):
        raise ValueError('보관 중 원본 Caddyfile이 변경됐습니다.')
    fd = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as file:
        file.write(result)
        file.flush()
        os.fsync(file.fileno())
    fd = os.open(directory / 'CAPTURE-SHA256SUMS',
                 os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w', encoding='ascii') as file:
        file.write(f'{original_hash}  Caddyfile.original\n')
        file.write(f'{digest(candidate)}  Caddyfile.maintenance\n')
        file.flush()
        os.fsync(file.fileno())
    for path in (original, directory, base):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    return directory


def verify_snapshot(directory, source, generator, *, require_current=True):
    trusted(directory, directory=True)
    if directory.lstat().st_mode & 0o077:
        raise ValueError('보관 디렉터리가 root 전용이 아닙니다.')
    trusted(source, directory=False)
    original = directory / 'Caddyfile.original'
    candidate = directory / 'Caddyfile.maintenance'
    manifest = directory / 'CAPTURE-SHA256SUMS'
    for path in (original, candidate, manifest):
        trusted(path, directory=False)
    if candidate.lstat().st_mode & 0o077 or manifest.lstat().st_mode & 0o077:
        raise ValueError('후보 또는 체크섬 파일이 root 전용이 아닙니다.')
    expected = (f'{digest(original)}  Caddyfile.original\n'
                f'{digest(candidate)}  Caddyfile.maintenance\n')
    if manifest.stat().st_size > 1024 or manifest.read_text(encoding='ascii') != expected:
        raise ValueError('Caddy 보관 체크섬이 다릅니다.')
    if require_current and (digest(source) != digest(original) or
                            metadata(source) != metadata(original)):
        raise ValueError('현재 Caddyfile이 보관된 원본과 다릅니다.')
    module = candidate_module(generator)
    if candidate.read_text(encoding='utf-8') != module.candidate(original.read_text(encoding='utf-8')):
        raise ValueError('보관된 유지보수 후보가 현재 생성 규칙과 다릅니다.')


def main():
    if os.geteuid() != 0 or not (len(sys.argv) == 1 or
                                  (len(sys.argv) == 3 and sys.argv[1] == 'verify')):
        raise SystemExit('root로 인자 없이 실행하거나 verify 보관경로를 전달하세요.')
    os.umask(0o077)
    try:
        source = Path('/etc/caddy/Caddyfile')
        generator = Path(__file__).absolute().with_name('create-maintenance-caddy.py')
        if len(sys.argv) == 1:
            capture(source, Path('/var/backups'), generator)
        else:
            verify_snapshot(Path(sys.argv[2]), source, generator)
    except (OSError, UnicodeError, ValueError) as exc:
        raise SystemExit(f'Caddy 보관 또는 검증 실패. 기록을 보존하세요: {exc}') from None
    if len(sys.argv) == 1:
        print('Caddy 원본 보관과 유지보수 후보 생성 완료; 설정은 적용하지 않았습니다.')
    else:
        print('Caddy 보관 내용과 현재 원본 일치 확인; 설정은 변경하지 않았습니다.')


if __name__ == '__main__':
    main()
