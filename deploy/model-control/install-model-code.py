#!/usr/bin/env python3
"""Install model-control code into a new path; no service control or CLI.

The caller provides a verified release and a fresh root-owned cache. Partial
targets are retained on failure for inspection and must never be reused.
"""
import importlib.util
import os
import re
import stat
import subprocess
import sys
from pathlib import Path


def install(source, target, cache, *, check_ready, offline=False):
    source, target, cache = map(Path, (source, target, cache))
    if os.geteuid() != 0 or not callable(check_ready) or type(offline) is not bool:
        raise ValueError('root와 필수 준비 검사기가 필요합니다.')
    if any(not path.is_absolute() or '..' in path.parts for path in (source, target, cache)):
        raise ValueError('절대 경로가 필요합니다.')
    # The initial production installation has one fixed destination. Test
    # destinations are restricted to the dedicated /opt fixture namespace.
    if target.parent != Path('/opt') or not (target.name == 'bc250-model-control'
            or re.fullmatch(r'bc250-model-code-fixture\.[A-Za-z0-9]{8}', target.name)):
        raise ValueError('모델 제어 설치 경로가 올바르지 않습니다.')
    helper_path = source / 'deploy/model-control/install-studio-release.py'
    spec = importlib.util.spec_from_file_location('model_install_checks', helper_path)
    # Validate the helper before loading any source code.
    for item in (helper_path, *helper_path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or item.is_symlink():
            raise ValueError('릴리스 검사 도구 경로를 신뢰할 수 없습니다.')
    info = helper_path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError('릴리스 검사 도구가 일반 파일이 아닙니다.')
    helper = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(helper)
    finally:
        sys.dont_write_bytecode = previous
    helper.trusted(source, directory=True)
    helper.trusted(target.parent, directory=True)
    helper.trusted(cache, directory=True)
    if cache.stat().st_mode & 0o077:
        raise ValueError('의존성 캐시는 root 전용이어야 합니다.')
    helper.trusted_cache(cache)
    helper.trusted_tree(source / 'backend')
    for name in ('pyproject.toml', 'uv.lock', 'backend/app/main.py'):
        helper.trusted(source / name, directory=False)
    uv = Path('/usr/bin/uv')
    helper.trusted(uv, directory=False)
    if uv.stat().st_mode & 0o777 != 0o755:
        raise ValueError('uv 실행 파일 권한이 올바르지 않습니다.')
    if target.exists() or target.is_symlink():
        raise ValueError('기존 모델 제어 설치가 있습니다. 보존하고 중단하세요.')
    if check_ready() is not True:
        raise ValueError('설치 준비 상태를 확인하지 못했습니다.')
    target.mkdir(mode=0o755)
    os.chmod(target, 0o755)
    subprocess.run(['/usr/bin/cp', '-a', '--', str(source / 'backend'), str(target / 'backend')], check=True)
    for name in ('pyproject.toml', 'uv.lock'):
        subprocess.run(['/usr/bin/cp', '-a', '--', str(source / name), str(target / name)], check=True)
    if check_ready() is not True:
        raise ValueError('의존성 설치 전 준비 상태를 확인하지 못했습니다.')
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'UV_PYTHON_DOWNLOADS': 'never',
           'UV_LINK_MODE': 'copy', 'UV_CACHE_DIR': str(cache), 'PYTHONNOUSERSITE': '1'}
    if offline:
        env['UV_OFFLINE'] = '1'
    subprocess.run([str(uv), 'sync', '--locked', '--no-dev', '--no-editable', '--python', '/usr/bin/python3'],
                   cwd=target, env=env, check=True, timeout=7200, umask=0o022)
    subprocess.run(['/usr/bin/chmod', '-R', 'a+rX,go-w', str(target)], check=True)
    subprocess.run(['/usr/sbin/restorecon', '-RF', str(target)], check=True)
    subprocess.run([str(target / '.venv/bin/python'), '-I', '-c',
                    'import sys; from pathlib import Path; import app.services.model_control_runtime as w; '
                    'import app.services.model_management_server as a; import app.gate as g; '
                    'root=Path(sys.prefix).resolve(); '
                    'assert all(Path(m.__file__).resolve().is_relative_to(root) for m in (w,a,g))'],
                   cwd=target, env=env, check=True, timeout=60)
    helper.sync_dir(target)
    helper.sync_dir(target.parent)
    return target
