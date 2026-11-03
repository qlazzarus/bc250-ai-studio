#!/usr/bin/env python3
"""Create first-install settings and empty journal; no service changes or CLI.

The authenticated-release check is supplied by the caller. A partial result is
always preserved, and an existing directory prevents a second attempt.
"""
import grp
import importlib.util
import os
import pwd
import stat
import sys
from pathlib import Path

STATE = Path('/var/lib/bc250-model-control')
CONFIG = Path('/etc/bc250-model-control')
GATE = Path('/var/lib/bc250-llm-gate')
CODE = Path('/opt/bc250-model-control')


def trusted(path, *, directory):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('절대 경로가 필요합니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('준비 도구 또는 상위 경로를 신뢰할 수 없습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('준비 경로가 디렉터리가 아닙니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('준비 도구가 단일 링크의 일반 파일이 아닙니다.')


def load(name, path):
    trusted(path, directory=False)
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    before = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(result)
    finally:
        sys.dont_write_bytecode = before
    return result


def prepare(source, *, check_release):
    source = Path(source)
    if os.geteuid() != 0 or not callable(check_release):
        raise ValueError('root와 인증된 릴리스 검사기가 필요합니다.')
    trusted(source, directory=True)
    if check_release() is not True:
        raise ValueError('릴리스 확인에 실패했습니다.')
    for target in (STATE, CONFIG, GATE, CODE):
        trusted(target.parent, directory=True)
        if target.exists() or target.is_symlink():
            raise ValueError('기존 상태·설정·코드가 있습니다. 보존하고 중단하세요.')
    grp.getgrnam('ai-studio')
    pwd.getpwnam('ai-gate')
    state = load('prepare_state', source / 'prepare-state.py')
    secrets = load('prepare_secrets', source / 'prepare-secrets.py')
    verifier = load('verify_staged_secrets', source / 'verify-staged-secrets.py')
    state.DIRECTORY = STATE
    secrets.DIRECTORY = CONFIG
    verifier.DIRECTORY = CONFIG
    if check_release() is not True:
        raise ValueError('준비 직전 릴리스 확인에 실패했습니다.')
    state.main()
    secrets.main()
    verifier.main()
    if (STATE / 'legacy-pause.json').exists() or (STATE / 'switch.json').read_bytes() != b'{}\n':
        raise ValueError('빈 전환 기록 또는 pause 기록 상태가 올바르지 않습니다.')
    return True
