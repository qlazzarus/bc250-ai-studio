#!/usr/bin/env python3
"""Compare one process to externally trusted expectations; not a code proof.

The caller must authenticate the unit, trusted paths, expected arguments and
service account, and fence changes while using this observation. Python may
already have imported code from other locations; /proc cannot prove otherwise.
"""
import os
import stat
from pathlib import Path

PROC = Path('/proc')
MAX_CMDLINE = 65536


def starttime(pid):
    text = (PROC / str(pid) / 'stat').read_text(encoding='ascii')
    close = text.rfind(')')
    fields = text[close + 1:].split() if close >= 0 else []
    if len(fields) <= 19 or not fields[19].isdecimal():
        raise ValueError('시작 시각 확인 실패')
    return fields[19]


def object_id(path):
    info = path.stat()
    return info.st_dev, info.st_ino


def verify(identity, *, main_pid, python, cwd, argv, uid):
    if (not isinstance(identity, tuple) or len(identity) != 2 or type(identity[0]) is not int
            or identity[0] <= 1 or type(identity[1]) is not str or not identity[1].isdecimal()
            or not callable(main_pid) or type(uid) is not int or uid < 0
            or not isinstance(argv, tuple) or not argv
            or any(type(value) is not bytes or not value or b'\0' in value for value in argv)):
        raise ValueError('프로세스 검사 인자가 올바르지 않습니다.')
    python, cwd = Path(python), Path(cwd)
    if (not python.is_absolute() or not cwd.is_absolute()
            or '..' in python.parts or '..' in cwd.parts
            or not stat.S_ISREG(python.stat().st_mode) or not stat.S_ISDIR(cwd.stat().st_mode)):
        raise ValueError('실행 파일 또는 작업 디렉터리 확인 실패')
    pid, expected_start = identity
    process = PROC / str(pid)
    if main_pid() != pid or starttime(pid) != expected_start:
        raise ValueError('시험 전 주 프로세스가 달라졌습니다.')
    exe_id, cwd_id = object_id(python), object_id(cwd)
    if object_id(process / 'exe') != exe_id or object_id(process / 'cwd') != cwd_id:
        raise ValueError('실행 파일 또는 작업 디렉터리가 다릅니다.')
    with (process / 'cmdline').open('rb') as file:
        data = file.read(MAX_CMDLINE + 1)
    if len(data) > MAX_CMDLINE or not data.endswith(b'\0') or tuple(data[:-1].split(b'\0')) != argv:
        raise ValueError('프로세스 인자가 다릅니다.')
    lines = (process / 'status').read_text(encoding='ascii').splitlines()
    matches = [line.partition(':')[2].split() for line in lines if line.startswith('Uid:')]
    if len(matches) != 1 or len(matches[0]) != 4 or matches[0] != [str(uid)] * 4:
        raise ValueError('프로세스 UID가 다릅니다.')
    if (main_pid() != pid or starttime(pid) != expected_start
            or object_id(python) != exe_id or object_id(process / 'exe') != exe_id
            or object_id(cwd) != cwd_id or object_id(process / 'cwd') != cwd_id):
        raise ValueError('검사 중 프로세스 또는 경로가 변경됐습니다.')
    return True
