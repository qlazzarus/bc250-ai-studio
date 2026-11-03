#!/usr/bin/env python3
"""Candidate runtime mask for the known Wiki caller; no CLI.

This only fences the systemd-managed Wiki unit. It does not block other local
callers, direct process launches, or database writers. Failures retain the
runtime mask and append-only evidence for operator inspection.
"""
import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

UNIT = 'bc250-family-wiki.service'
RUNTIME = Path('/run/systemd/system')


def properties():
    names = ('LoadState', 'ActiveState', 'MainPID', 'Job', 'KillMode', 'ControlGroup', 'Slice', 'FragmentPath')
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', UNIT,
        *['-p' + name for name in names]], capture_output=True, text=True, check=True, timeout=10)
    result_fields = {}
    for line in result.stdout.splitlines():
        key, sep, value = line.partition('=')
        if not sep or key in result_fields:
            raise ValueError('Wiki 서비스 상태를 확인하지 못했습니다.')
        result_fields[key] = value
    if set(result_fields) != set(names):
        raise ValueError('Wiki 서비스 속성이 불완전합니다.')
    return result_fields, result.stdout


class WikiFence:
    def __init__(self, guard, record_dir):
        self.guard = Path(guard)
        self.record_dir = Path(record_dir)
        if os.geteuid() != 0:
            raise ValueError('root가 필요합니다.')
        for path in (self.guard, self.record_dir):
            if not path.is_absolute() or '..' in path.parts:
                raise ValueError('검사기 또는 기록 경로가 올바르지 않습니다.')
            for parent in (path, *path.parents):
                info = parent.lstat()
                if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
                    raise ValueError('검사기 또는 기록 경로를 신뢰할 수 없습니다.')
                if parent != self.guard and not stat.S_ISDIR(info.st_mode):
                    raise ValueError('기록 상위 경로가 올바르지 않습니다.')
            info = path.lstat()
            if path == self.guard and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
                raise ValueError('cgroup 검사기가 일반 파일이 아닙니다.')
        if stat.S_IMODE(self.record_dir.stat().st_mode) != 0o700:
            raise ValueError('기록 경로는 root 전용이어야 합니다.')
        self.record = self.record_dir / 'wiki-fence.jsonl'
        self.was_active = None

    def append(self, value, *, create=False):
        flags = os.O_WRONLY | os.O_APPEND | os.O_CLOEXEC | os.O_NOFOLLOW
        if create:
            flags |= os.O_CREAT | os.O_EXCL
        fd = os.open(self.record, flags, 0o600)
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 65536):
                raise ValueError('Wiki 차단 기록이 올바르지 않습니다.')
            data = (json.dumps(value, separators=(',', ':')) + '\n').encode()
            while data:
                count = os.write(fd, data)
                if count <= 0:
                    raise OSError('Wiki 차단 기록을 쓰지 못했습니다.')
                data = data[count:]
            os.fsync(fd)
        finally:
            os.close(fd)
        fd = os.open(self.record_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def check(self):
        for parent in (RUNTIME, *RUNTIME.parents):
            info = parent.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('systemd runtime 경로를 신뢰할 수 없습니다.')
        mask = RUNTIME / UNIT
        if not mask.is_symlink() or os.readlink(mask) != '/dev/null':
            raise ValueError('시험 또는 운영 Wiki의 임시 mask가 없습니다.')
        data, raw = properties()
        if (data['LoadState'] != 'masked' or data['FragmentPath'] != '/dev/null'
                or data['ActiveState'] != 'inactive'
                or data['MainPID'] != '0' or data['Job'] != ''):
            raise ValueError('Wiki runtime mask 또는 정지 상태가 적용되지 않았습니다.')
        spec = importlib.util.spec_from_file_location('wiki_cgroup', self.guard)
        helper = importlib.util.module_from_spec(spec)
        previous = sys.dont_write_bytecode
        try:
            sys.dont_write_bytecode = True
            spec.loader.exec_module(helper)
        finally:
            sys.dont_write_bytecode = previous
        helper.check(UNIT, raw)
        return True

    def acquire(self):
        mask = RUNTIME / UNIT
        if mask.exists() or mask.is_symlink():
            raise ValueError('기존 Wiki runtime unit 또는 mask를 보존하고 중단하세요.')
        data, _ = properties()
        if (data['LoadState'] != 'loaded' or data['ActiveState'] not in {'active', 'inactive'}
                or data['Job'] != '' or (data['ActiveState'] == 'inactive' and data['MainPID'] != '0')
                or (data['ActiveState'] == 'active' and (not data['MainPID'].isdecimal() or int(data['MainPID']) <= 1))):
            raise ValueError('기존 Wiki 상태가 안정적이지 않습니다.')
        # /etc overrides /run in systemd's unit search path. A runtime mask
        # therefore cannot fence the actual production unit at that location.
        fragment = Path(data['FragmentPath'])
        if not fragment.is_absolute() or fragment == Path('/etc/systemd/system') or fragment.is_relative_to('/etc/systemd/system'):
            raise ValueError('/etc에 있는 Wiki unit에는 runtime mask를 사용할 수 없습니다.')
        self.was_active = data['ActiveState'] == 'active'
        self.append({'event': 'acquire:begin', 'unit': UNIT, 'was_active': self.was_active}, create=True)
        subprocess.run(['/usr/bin/systemctl', 'mask', '--runtime', '--now', UNIT], check=True, timeout=120)
        self.check()
        self.append({'event': 'acquire:confirmed'})
        return True

    def release(self):
        if self.was_active is None:
            raise ValueError('이 프로세스에서 완료된 Wiki 차단이 없습니다.')
        self.check()
        self.append({'event': 'release:begin'})
        subprocess.run(['/usr/bin/systemctl', 'unmask', '--runtime', UNIT], check=True, timeout=120)
        if (RUNTIME / UNIT).exists() or (RUNTIME / UNIT).is_symlink():
            raise ValueError('Wiki runtime mask 제거가 확인되지 않았습니다.')
        if self.was_active:
            subprocess.run(['/usr/bin/systemctl', 'start', UNIT], check=True, timeout=120)
        data, _ = properties()
        expected = 'active' if self.was_active else 'inactive'
        if data['LoadState'] != 'loaded' or data['ActiveState'] != expected or data['Job'] != '':
            raise ValueError('Wiki의 이전 서비스 상태를 확인하지 못했습니다.')
        self.append({'event': 'release:confirmed'})
        self.was_active = None
        return True
