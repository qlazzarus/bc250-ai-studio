#!/usr/bin/env python3
"""Candidate stopped-Studio release installer; no service control or CLI.

The caller must provide a trusted release, verified compatible backup and a
real maintenance/quiescence check. On failure it leaves both old and partial
new files for inspection. The data directory and active model are never touched.
"""

import hashlib
import os
import stat
import subprocess
from pathlib import Path

ITEMS = ('backend', 'config', 'frontend', 'pyproject.toml', 'uv.lock', '.venv')
BUILD_OVERRIDES = ('setup.py', 'setup.cfg', 'MANIFEST.in', 'sitecustomize.py',
                   'usercustomize.py', 'uv.toml')


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
            raise ValueError('설치 파일이 단일 링크의 일반 파일이 아닙니다.')


def trusted_tree(root):
    trusted(root, directory=True)
    if root.stat().st_mode & 0o055 != 0o055:
        raise ValueError('릴리스 디렉터리를 서비스가 탐색할 수 없습니다.')
    def onerror(error):
        raise error
    for parent, dirs, files in os.walk(root, followlinks=False, onerror=onerror):
        for name in dirs + files:
            path = Path(parent) / name
            info = path.lstat()
            if (info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode)
                    or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode))):
                raise ValueError('릴리스 트리에 신뢰할 수 없는 항목이 있습니다.')
            required = 0o055 if stat.S_ISDIR(info.st_mode) else 0o044
            if info.st_mode & required != required:
                raise ValueError('릴리스 파일을 서비스가 읽을 수 없습니다.')


def trusted_cache(root):
    trusted(root, directory=True)
    def onerror(error):
        raise error
    for parent, dirs, files in os.walk(root, followlinks=False, onerror=onerror):
        for name in dirs + files:
            path = Path(parent) / name
            info = path.lstat()
            if info.st_uid != 0:
                raise ValueError('의존성 캐시에 root 소유가 아닌 항목이 있습니다.')
            if stat.S_ISLNK(info.st_mode):
                if not path.resolve(strict=True).is_relative_to(root.resolve(strict=True)):
                    raise ValueError('의존성 캐시 링크가 캐시 밖을 가리킵니다.')
            elif info.st_mode & 0o022:
                raise ValueError('의존성 캐시에 그룹 또는 다른 사용자가 쓸 수 있는 항목이 있습니다.')
            elif not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise ValueError('의존성 캐시에 지원하지 않는 파일 형식이 있습니다.')


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def require_same_model_config(source, current):
    """Refuse an unreviewed replacement without disclosing either file."""
    digests = []
    for path in (source, current):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        with os.fdopen(fd, 'rb') as file:
            before = os.fstat(file.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > 1024 * 1024:
                raise ValueError('Studio 모델 설정 파일을 확인할 수 없습니다.')
            digest = hashlib.file_digest(file, 'sha256').digest()
            after = os.fstat(file.fileno())
            if any(getattr(before, name) != getattr(after, name) for name in
                   ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')):
                raise ValueError('검사 중 Studio 모델 설정이 변경됐습니다.')
            digests.append(digest)
    if digests[0] != digests[1]:
        raise ValueError('운영 Studio 모델 설정이 릴리스와 다릅니다. 설치를 중단합니다.')


def install(source, app, displaced, cache, *, check_ready, compare, offline=False):
    """Install a release in the final Studio path, creating its venv there.

    compare must check copied content/metadata; check_ready must verify an
    independently completed backup, stopped services, maintenance and local
    quiescence. Both are supplied by the trusted coordinator, not end users.
    """
    source, app, displaced, cache = map(Path, (source, app, displaced, cache))
    if os.geteuid() != 0 or not callable(check_ready) or not callable(compare) or type(offline) is not bool:
        raise ValueError('root와 필수 검증기가 필요합니다.')
    for path in (source, app, displaced, cache):
        trusted(path, directory=True)
    if stat.S_IMODE(app.stat().st_mode) != 0o755:
        raise ValueError('Studio 설치 디렉터리 권한이 예상과 다릅니다.')
    if displaced.stat().st_mode & 0o077 or cache.stat().st_mode & 0o077:
        raise ValueError('보존 경로와 의존성 캐시는 root 전용이어야 합니다.')
    trusted_cache(cache)
    if any(displaced.iterdir()):
        raise ValueError('보존 경로가 비어 있지 않습니다.')
    if app.stat().st_dev != displaced.stat().st_dev:
        raise ValueError('Studio 경로와 보존 경로가 다른 파일 시스템입니다.')
    for name in ('backend', 'frontend/dist'):
        trusted_tree(source / name)
    for name in ('config/models.yaml', 'pyproject.toml', 'uv.lock'):
        trusted(source / name, directory=False)
        if (source / name).stat().st_mode & 0o044 != 0o044:
            raise ValueError('릴리스 설정을 서비스가 읽을 수 없습니다.')
    for name in ('backend/app/main.py', 'backend/alembic/env.py', 'frontend/dist/index.html'):
        trusted(source / name, directory=False)
    for name in ITEMS:
        path = app / name
        if path.is_symlink() or not path.exists():
            raise ValueError('기존 Studio 설치가 불완전하거나 링크입니다.')
        wants_dir = name in ('backend', 'config', 'frontend', '.venv')
        if wants_dir != path.is_dir() or (not wants_dir and not path.is_file()):
            raise ValueError('기존 Studio 대상 형식이 올바르지 않습니다.')
    for name in BUILD_OVERRIDES:
        path = app / name
        if path.exists() or path.is_symlink():
            raise ValueError('예상하지 않은 Python 빌드 설정이 있습니다.')
    for path in (app / 'config/models.yaml', app / 'frontend/dist'):
        if path.is_symlink() or not path.exists():
            raise ValueError('기존 모델 설정 또는 프런트엔드 경로가 올바르지 않습니다.')
    require_same_model_config(source / 'config/models.yaml', app / 'config/models.yaml')
    uv = Path('/usr/bin/uv')
    trusted(uv, directory=False)
    if stat.S_IMODE(uv.stat().st_mode) != 0o755:
        raise ValueError('root 관리 uv 권한이 올바르지 않습니다.')
    if check_ready() is not True:
        raise ValueError('백업 또는 서비스 유휴 상태를 확인하지 못했습니다.')
    prepared, old, unused = (displaced / part for part in ('prepared', 'previous', 'unused'))
    for path in (prepared, old, unused):
        path.mkdir(mode=0o700)
    for name in ('config', 'frontend'):
        subprocess.run(['/usr/bin/cp', '-a', '--', str(app / name), str(prepared / name)], check=True)
        compare(app / name, prepared / name)
    for name in ('config/models.yaml', 'frontend/dist'):
        item = prepared / name
        if item.is_symlink() or not item.exists():
            raise ValueError('준비된 기존 파일이 올바르지 않습니다.')
        destination = unused / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.rename(item, destination)
        subprocess.run(['/usr/bin/cp', '-a', '--', str(source / name), str(item)], check=True)
        compare(source / name, item)
    for name in ('backend', 'pyproject.toml', 'uv.lock'):
        subprocess.run(['/usr/bin/cp', '-a', '--', str(source / name), str(prepared / name)], check=True)
        compare(source / name, prepared / name)
    subprocess.run(['/usr/bin/sync', '-f', str(displaced)], check=True)
    if check_ready() is not True:
        raise ValueError('설치 직전 유휴 상태를 확인하지 못했습니다.')
    require_same_model_config(source / 'config/models.yaml', app / 'config/models.yaml')
    for name in ITEMS:
        os.rename(app / name, old / name)
        if name != '.venv':
            os.rename(prepared / name, app / name)
        sync_dir(app)
        sync_dir(old)
    trusted_tree(app / 'backend')
    for name in ('pyproject.toml', 'uv.lock'):
        trusted(app / name, directory=False)
    for name in ('backend', 'config/models.yaml', 'frontend/dist', 'pyproject.toml', 'uv.lock'):
        subprocess.run(['/usr/sbin/restorecon', '-RF', str(app / name)], check=True)
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'UV_PYTHON_DOWNLOADS': 'never',
           'UV_LINK_MODE': 'copy', 'UV_CACHE_DIR': str(cache), 'PYTHONNOUSERSITE': '1'}
    if offline:
        env['UV_OFFLINE'] = '1'
    subprocess.run([str(uv), 'sync', '--locked', '--no-dev', '--python', '/usr/bin/python3'],
                   cwd=app, env=env, check=True, timeout=7200, umask=0o022)
    subprocess.run(['/usr/bin/chmod', '-R', 'a+rX,go-w', str(app / '.venv')], check=True)
    subprocess.run(['/usr/sbin/restorecon', '-RF', str(app / '.venv')], check=True)
    subprocess.run([str(app / '.venv/bin/python'), '-I', '-c',
                    'from pathlib import Path; import app; from app.core.config import ROOT; '
                    'assert Path(app.__file__).resolve().parent == ROOT / "backend/app"; '
                    'assert ROOT == Path.cwd()'], cwd=app, env=env, check=True, timeout=60)
    subprocess.run(['/usr/bin/sync', '-f', str(app)], check=True)
    return displaced
