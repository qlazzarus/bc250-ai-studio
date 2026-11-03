#!/usr/bin/env python3
"""Verify a completed first-preparation record and untouched initial state."""
import grp
import json
import os
import stat
from pathlib import Path

STATE = Path('/var/lib/bc250-model-control')
GATE = Path('/var/lib/bc250-llm-gate')
CODE = Path('/opt/bc250-model-control')


def trusted(path, *, directory):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('준비 기록 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('준비 기록 경로를 신뢰할 수 없습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('준비 기록 상위 경로가 올바르지 않습니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('준비 기록이 단일 링크의 일반 파일이 아닙니다.')


def verify(directory, commit, digest):
    directory = Path(directory)
    if os.geteuid() != 0:
        raise ValueError('root가 필요합니다.')
    trusted(directory, directory=True)
    if stat.S_IMODE(directory.stat().st_mode) != 0o700:
        raise ValueError('준비 기록 경로는 root 전용이어야 합니다.')
    path = directory / 'migration-events.jsonl'
    trusted(path, directory=False)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 65536):
            raise ValueError('준비 기록 파일이 올바르지 않습니다.')
        data = file.read(65537)
    try:
        rows = [json.loads(line) for line in data.splitlines()]
    except (ValueError, UnicodeError):
        raise ValueError('준비 기록을 읽을 수 없습니다.') from None
    if (len(rows) != 3 or not all(isinstance(row, dict) for row in rows)
            or [row.get('event') for row in rows] != ['release', 'initial_preparation:begin', 'initial_preparation:confirmed']
            or rows[0].get('commit') != commit or rows[0].get('sha256') != digest):
        raise ValueError('동일 릴리스의 완료된 준비 기록이 아닙니다.')
    trusted(STATE, directory=True)
    group = grp.getgrnam('ai-studio').gr_gid
    state_info = STATE.lstat()
    if state_info.st_gid != group or stat.S_IMODE(state_info.st_mode) != 0o750:
        raise ValueError('초기 상태 디렉터리 권한이 다릅니다.')
    switch = STATE / 'switch.json'
    trusted(switch, directory=False)
    info = switch.lstat()
    if (info.st_gid != group or stat.S_IMODE(info.st_mode) != 0o640 or info.st_size != 3
            or switch.read_bytes() != b'{}\n'):
        raise ValueError('초기 전환 journal이 비어 있지 않습니다.')
    for path in (STATE / 'legacy-pause.json', GATE, CODE):
        if path.exists() or path.is_symlink():
            raise ValueError('초기 준비 이후 상태가 변경됐습니다.')
    return True
