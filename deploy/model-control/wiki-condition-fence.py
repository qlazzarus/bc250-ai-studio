#!/usr/bin/env python3
"""Candidate condition fence for the known Wiki unit; no CLI.

It covers only systemd starts of this unit. Runtime mode ends at reboot;
persistent mode needs a separate reboot test and recovery procedure. Neither blocks other
local processes, direct executables, DB writers or root administrators. The
caller supplies trusted release tools and must maintain all other exclusions.
Failures leave marker, drop-in and records for inspection.
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
MARKER_DIR = Path('/run/bc250-wiki-maintenance')
PERSISTENT_UNITS = Path('/etc/systemd/system')
PERSISTENT_MARKER = Path('/var/lib/bc250-wiki-maintenance')
DROPIN_NAME = '90-bc250-wiki-maintenance.conf'


def trusted(path, *, directory):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Wiki 차단 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('Wiki 차단 경로를 신뢰할 수 없습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('Wiki 차단 디렉터리가 올바르지 않습니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('Wiki 차단 파일이 단일 링크의 일반 파일이 아닙니다.')


def load(name, path):
    trusted(path, directory=False)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    old = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = old
    return module


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def create_file(path, content, mode):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    try:
        os.fchmod(fd, mode)
        view = memoryview(content)
        while view:
            count = os.write(fd, view)
            if count <= 0:
                raise OSError('Wiki 차단 파일을 쓰지 못했습니다.')
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)
    sync_dir(path.parent)


class WikiConditionFence:
    def __init__(self, source, record_dir, *, persistent=False):
        if os.geteuid() != 0 or type(persistent) is not bool:
            raise ValueError('root가 필요합니다.')
        self.unit_dir = PERSISTENT_UNITS if persistent else RUNTIME
        self.marker_dir = PERSISTENT_MARKER if persistent else MARKER_DIR
        self.persistent = persistent
        self.source = Path(source)
        trusted(self.source, directory=True)
        self.common = load('wiki_fence_common', self.source / 'wiki-maintenance-fence.py')
        self.reader = load('wiki_condition_reader', self.source / 'read-systemd-conditions.py')
        self.verifier = load('wiki_condition_verifier', self.source / 'verify-wiki-condition.py')
        self.common.UNIT = UNIT
        self.record = self.common.WikiFence(self.source / 'check-service-cgroup.py', record_dir)
        self.guard = load('wiki_condition_cgroup', self.source / 'check-service-cgroup.py')
        self.was_active = None
        self.owns_dropin_dir = False

    @property
    def marker(self):
        return self.marker_dir / 'blocked'

    @property
    def dropin(self):
        return self.unit_dir / (UNIT + '.d') / DROPIN_NAME

    def content(self):
        return ('[Unit]\nConditionPathExists=!' + str(self.marker) + '\n').encode()

    def state(self):
        names = ('LoadState', 'ActiveState', 'MainPID', 'Job', 'KillMode', 'ControlGroup',
                 'Slice', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload')
        result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', UNIT,
            *['-p' + name for name in names]], capture_output=True, text=True, check=True, timeout=10)
        values = {}
        for line in result.stdout.splitlines():
            key, sep, value = line.partition('=')
            if not sep or key in values:
                raise ValueError('Wiki 서비스 속성을 확인하지 못했습니다.')
            values[key] = value
        if set(values) != set(names):
            raise ValueError('Wiki 서비스 속성이 불완전합니다.')
        return values, result.stdout

    def check(self):
        trusted(self.marker, directory=False)
        trusted(self.dropin, directory=False)
        if (stat.S_IMODE(self.marker_dir.stat().st_mode) != 0o700
                or stat.S_IMODE(self.marker.stat().st_mode) != 0o600
                or self.marker.stat().st_size != 0
                or stat.S_IMODE(self.dropin.stat().st_mode) != 0o644
                or self.dropin.stat().st_size != len(self.content())
                or self.dropin.read_bytes() != self.content()):
            raise ValueError('Wiki 차단 marker 또는 drop-in이 변경됐습니다.')
        values, raw = self.state()
        if (values['LoadState'] != 'loaded' or values['ActiveState'] != 'inactive'
                or values['MainPID'] != '0' or values['Job'] != ''
                or values['NeedDaemonReload'] != 'no'
                or str(self.dropin) not in values['DropInPaths'].split()):
            raise ValueError('Wiki 정지 또는 drop-in 적용을 확인하지 못했습니다.')
        self.guard.check(UNIT, raw)
        self.verifier.require_block_condition(self.reader.read_conditions(UNIT), str(self.marker))
        return True

    def acquire(self):
        trusted(self.unit_dir, directory=True)
        trusted(self.marker_dir.parent, directory=True)
        if self.marker_dir.exists() or self.marker_dir.is_symlink() or self.dropin.exists() or self.dropin.is_symlink():
            raise ValueError('기존 Wiki marker 또는 drop-in이 있습니다. 보존하고 중단하세요.')
        values, _ = self.state()
        if (values['LoadState'] != 'loaded' or values['ActiveState'] not in ('active', 'inactive')
                or values['Job'] != '' or values['NeedDaemonReload'] != 'no'
                or (values['ActiveState'] == 'inactive' and values['MainPID'] != '0')
                or (values['ActiveState'] == 'active' and
                    (not values['MainPID'].isdecimal() or int(values['MainPID']) <= 1))):
            raise ValueError('Wiki의 기존 상태가 안정적이지 않습니다.')
        parent = self.dropin.parent
        if parent.exists() or parent.is_symlink():
            trusted(parent, directory=True)
        created_dropin_dir = not parent.exists()
        self.was_active = values['ActiveState'] == 'active'
        self.record.append({'event': 'condition:begin', 'unit': UNIT, 'was_active': self.was_active,
                            'persistent': self.persistent, 'created_dropin_dir': created_dropin_dir}, create=True)
        self.marker_dir.mkdir(mode=0o700)
        os.chmod(self.marker_dir, 0o700)
        sync_dir(self.marker_dir.parent)
        create_file(self.marker, b'', 0o600)
        if not parent.exists():
            parent.mkdir(mode=0o755)
            os.chmod(parent, 0o755)
            self.owns_dropin_dir = True
            sync_dir(parent.parent)
        create_file(self.dropin, self.content(), 0o644)
        subprocess.run(['/usr/sbin/restorecon', '-RF', str(self.marker_dir), str(self.dropin)],
                       check=True, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True, timeout=120)
        subprocess.run(['/usr/bin/systemctl', 'stop', UNIT], check=True, timeout=120)
        self.check()
        self.record.append({'event': 'condition:confirmed'})
        return True

    def resume_confirmed(self):
        """Inspect a completed persistent fence after process loss; never retry a partial operation."""
        if not self.persistent or self.was_active is not None:
            raise ValueError('영구 차단의 새 확인 과정이 필요합니다.')
        path = self.record.record
        trusted(path, directory=False)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        with os.fdopen(fd, 'rb') as file:
            info = os.fstat(file.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 16384):
                raise ValueError('Wiki 차단 기록이 올바르지 않습니다.')
            raw = file.read(16385)
            after = os.fstat(file.fileno())
            if any(getattr(info, field) != getattr(after, field) for field in
                   ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')):
                raise ValueError('확인 중 Wiki 차단 기록이 변경됐습니다.')
        try:
            rows = [json.loads(line) for line in raw.splitlines()]
        except (ValueError, UnicodeError):
            raise ValueError('Wiki 차단 기록을 읽지 못했습니다.') from None
        if (len(rows) != 2 or not all(isinstance(row, dict) for row in rows)
                or rows[0].get('event') != 'condition:begin' or rows[0].get('unit') != UNIT
                or rows[0].get('persistent') is not True or type(rows[0].get('was_active')) is not bool
                or type(rows[0].get('created_dropin_dir')) is not bool
                or rows[1] != {'event': 'condition:confirmed'}):
            raise ValueError('완료된 영구 Wiki 차단 기록이 아닙니다.')
        self.check()
        self.was_active = rows[0]['was_active']
        self.owns_dropin_dir = rows[0]['created_dropin_dir']
        return True

    def release(self, *, can_release):
        if self.was_active is None or not callable(can_release) or can_release() is not True:
            raise ValueError('Wiki 차단 해제 조건이 확인되지 않았습니다.')
        self.check()
        self.record.append({'event': 'release:begin'})
        self.dropin.unlink()
        sync_dir(self.dropin.parent)
        subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True, timeout=120)
        self.marker.unlink()
        self.marker_dir.rmdir()
        sync_dir(self.marker_dir.parent)
        if self.owns_dropin_dir:
            self.dropin.parent.rmdir()
            sync_dir(self.unit_dir)
        if self.was_active:
            subprocess.run(['/usr/bin/systemctl', 'start', UNIT], check=True, timeout=120)
        values, _ = self.state()
        expected = 'active' if self.was_active else 'inactive'
        if (values['LoadState'] != 'loaded' or values['ActiveState'] != expected
                or values['Job'] != '' or values['NeedDaemonReload'] != 'no'):
            raise ValueError('Wiki의 이전 서비스 상태를 확인하지 못했습니다.')
        self.record.append({'event': 'release:confirmed'})
        self.was_active = None
        return True
