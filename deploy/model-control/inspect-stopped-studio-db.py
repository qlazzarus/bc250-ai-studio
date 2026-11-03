#!/usr/bin/env python3
"""Inspect a private copy of stopped Studio's SQLite state; no service control.

The caller must maintain a verified service-stop and block direct database
writers throughout inspection and subsequent backup. This snapshot is not a
replacement for that persistent exclusion or for the complete backup.
"""
import json
import os
import pwd
import shutil
import sqlite3
import stat
import tempfile
from pathlib import Path

TERMINAL = frozenset({'completed', 'failed', 'cancelled', 'interrupted'})
MAX_FILE = 4 * 1024 * 1024 * 1024


def identity(info):
    return tuple(getattr(info, name) for name in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def trusted_parents(database, owners):
    for path in (database.parent, *database.parent.parents):
        info = path.lstat()
        if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
                or info.st_uid not in owners or info.st_mode & 0o022):
            raise ValueError('Studio 데이터 경로를 신뢰할 수 없습니다.')


def inspect(database, *, check_stopped):
    """Reject incomplete jobs and nonempty transition/recovery, without printing data."""
    database = Path(database)
    if (os.geteuid() != 0 or not database.is_absolute() or '..' in database.parts
            or not callable(check_stopped)):
        raise ValueError('root와 검증된 서비스 정지 검사기가 필요합니다.')
    owners = {0, pwd.getpwnam('ai-studio').pw_uid}
    trusted_parents(database, owners)
    if check_stopped() is not True:
        raise ValueError('Studio의 완전한 정지를 확인하지 못했습니다.')
    paths = [database, Path(str(database) + '-wal'), Path(str(database) + '-shm'),
             Path(str(database) + '-journal')]
    def metadata():
        values = []
        for path in paths:
            try:
                info = path.lstat()
            except FileNotFoundError:
                values.append(None)
                continue
            if (not stat.S_ISREG(info.st_mode) or info.st_uid not in owners or info.st_nlink != 1 or info.st_size > MAX_FILE
                    or info.st_mode & 0o022):
                raise ValueError('Studio 데이터베이스 파일을 신뢰할 수 없습니다.')
            values.append(identity(info))
        if values[0] is None:
            raise ValueError('Studio 데이터베이스가 없습니다.')
        return values
    before = metadata()
    with tempfile.TemporaryDirectory(prefix='bc250-studio-observation-') as directory:
        root = Path(directory)
        for path, expected in zip(paths, before):
            if expected is None:
                continue
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            with os.fdopen(fd, 'rb') as source, (root / path.name).open('xb') as target:
                if identity(os.fstat(source.fileno())) != expected:
                    raise ValueError('Studio 데이터베이스가 변경됐습니다.')
                shutil.copyfileobj(source, target, length=1024 * 1024)
                if identity(os.fstat(source.fileno())) != expected:
                    raise ValueError('Studio 데이터베이스 복사 중 변경됐습니다.')
        if metadata() != before or check_stopped() is not True:
            raise ValueError('Studio 정지 또는 데이터베이스 상태가 변경됐습니다.')
        copy = root / database.name
        connection = sqlite3.connect(copy.as_uri() + '?mode=ro', uri=True, timeout=10)
        try:
            connection.execute('PRAGMA query_only=ON')
            connection.execute('BEGIN')
            statuses = connection.execute('SELECT DISTINCT status FROM jobs').fetchall()
            if any(len(row) != 1 or not isinstance(row[0], str) or row[0] not in TERMINAL for row in statuses):
                raise ValueError('완료되지 않은 Studio 작업이 있습니다.')
            rows = connection.execute("SELECT key, value FROM system_state WHERE key IN ('transition', 'recovery')").fetchall()
            for _, value in rows:
                if not isinstance(value, str) or json.loads(value) != {}:
                    raise ValueError('Studio 복구 또는 전환 기록이 비어 있지 않습니다.')
        finally:
            connection.close()
    if check_stopped() is not True or metadata() != before:
        raise ValueError('Studio 상태 확인 중 변경이 감지됐습니다.')
    return True
