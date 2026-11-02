#!/usr/bin/env python3
"""Check a freshly staged credential set without printing or changing it.

This is an internal first-install check, not a deployment entry point. It
accepts exactly the files produced by prepare-secrets.py, and fails closed if
their syntax, permissions, or cross-file relationships are unexpected.
"""
import hmac
import os
import re
import stat
from pathlib import Path

DIRECTORY = Path('/etc/bc250-model-control')


def parse_env(raw):
    values = {}
    for line in raw.splitlines():
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or key in values:
            raise ValueError('환경 설정 형식이 올바르지 않습니다.')
        if not value or any(c.isspace() or ord(c) < 32 for c in value):
            raise ValueError('환경 설정 값 형식이 올바르지 않습니다.')
        values[key] = value
    return values


def validate(read):
    keys = {name: read(name).removesuffix('\n') for name in (
        'gate-admin-key', 'studio-gate-key', 'switch-gate-key', 'api-key', 'studio-coordination-key')}
    if any(not re.fullmatch(r'[0-9a-f]{64}', value) for value in keys.values()):
        raise ValueError('생성된 키 형식이 올바르지 않습니다.')
    if len(set(keys.values())) != len(keys):
        raise ValueError('생성된 키가 서로 다르지 않습니다.')
    llm = read('llm-key').removesuffix('\n')
    if any(c.isspace() or ord(c) < 32 for c in llm):
        raise ValueError('llama 키 형식이 올바르지 않습니다.')
    expected = {
        'gate.env': {'GATE_OWNED_CONTROL': 'true',
                     'GATE_STATE_PATH': '/var/lib/bc250-llm-gate/holds.json',
                     'GATE_API_KEY': keys['gate-admin-key'],
                     'GATE_STUDIO_KEY': keys['studio-gate-key'],
                     'GATE_SWITCH_KEY': keys['switch-gate-key']},
        'client-gate.env': {'LLM_GATE_API_KEY': keys['gate-admin-key']},
        'studio-gate.env': {'STUDIO_GPU_LOCK_PATH': '/run/bc250-gpu/gpu.lock',
                            'STUDIO_GPU_LOCK_SECURE_PRECREATED': 'true',
                            'STUDIO_SWITCH_JOURNAL_PATH': '/var/lib/bc250-model-control/switch.json',
                            'STUDIO_ADMISSION_OWNED_HOLDS': 'true',
                            'STUDIO_ADMISSION_URL': 'http://127.0.0.1:8081/control',
                            'STUDIO_ADMISSION_KEY': keys['studio-gate-key'],
                            'STUDIO_COORDINATION_KEY': keys['studio-coordination-key']},
        'worker.env': {'MODEL_CONTROL_SWITCH_ENABLED': 'false'},
    }
    for name, required in expected.items():
        actual = parse_env(read(name))
        if actual.keys() != required.keys() or any(
                not hmac.compare_digest(actual[key].encode(), value.encode()) for key, value in required.items()):
            raise ValueError('생성된 환경 설정이 키 또는 필수 설정과 일치하지 않습니다.')


def secure_read(name):
    path = DIRECTORY / name
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 16384):
            raise ValueError('설정 파일 소유권 또는 권한이 올바르지 않습니다.')
        raw = os.read(fd, 16385)
        if len(raw) > 16384:
            raise ValueError('설정 파일 크기가 너무 큽니다.')
        return raw.decode('utf-8')
    finally:
        os.close(fd)


def main():
    if os.geteuid() != 0:
        raise SystemExit('root가 필요합니다.')
    for path in (DIRECTORY, *DIRECTORY.parents):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('설정 디렉터리 경로를 신뢰할 수 없습니다.')
    if stat.S_IMODE(DIRECTORY.stat().st_mode) != 0o700:
        raise ValueError('설정 디렉터리가 root 전용이 아닙니다.')
    validate(secure_read)
    print('생성된 설정과 키 일치 및 전환 비활성 확인 완료')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, UnicodeError):
        raise SystemExit('신규 설정 검증 실패. 파일과 기록을 보존하고 확인하세요.') from None
