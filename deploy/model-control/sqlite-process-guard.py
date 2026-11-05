#!/usr/bin/env python3
"""Experimental SQLite reservation in a dedicated child, not a DB fence.

Direct file writes and DB pathname replacement races need separate controls.
Do not use this candidate to authorize an operational backup.
"""
import selectors
import stat
import subprocess
import sys
from pathlib import Path

CHILD = r'''import sqlite3,sys
c=sqlite3.connect(sys.argv[1],uri=True,timeout=0,isolation_level=None)
if c.execute('PRAGMA journal_mode').fetchone() != ('wal',): raise ValueError('WAL required')
c.execute('BEGIN IMMEDIATE')
print('held',flush=True)
for line in sys.stdin:
    if line.strip() == 'check':
        print('held' if c.in_transaction else 'lost',flush=True)
    elif line.strip() == 'release':
        c.rollback()
        break
    else:
        raise ValueError('invalid command')
c.close()
'''


class SQLiteProcessGuard:
    def __init__(self, database, timeout=5):
        self.path = Path(database)
        if not self.path.is_absolute() or '..' in self.path.parts or timeout <= 0:
            raise ValueError('DB 경로 또는 대기 시간이 올바르지 않습니다.')
        self.timeout = timeout
        self.process = None
        self.identity = None
        self.used = False

    def _identity(self):
        info = self.path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('단일 링크의 일반 DB 파일이 필요합니다.')
        return info.st_dev, info.st_ino

    def _read(self):
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            if not selector.select(self.timeout):
                raise TimeoutError('SQLite 잠금 프로세스 응답 시간 초과')
            return self.process.stdout.readline().strip()

    def acquire(self):
        if self.used:
            raise ValueError('SQLite 잠금 후보는 재사용할 수 없습니다.')
        self.used = True
        self.identity = self._identity()
        self.process = subprocess.Popen([sys.executable, '-I', '-u', '-c', CHILD,
                                         self.path.as_uri() + '?mode=rw'],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, text=True)
        try:
            if self._read() != 'held' or self.process.poll() is not None or self._identity() != self.identity:
                raise RuntimeError('SQLite 잠금 획득을 확인하지 못했습니다.')
        except BaseException:
            self.release()
            raise
        return True

    def check(self):
        if self.process is None or self.process.poll() is not None:
            return False
        try:
            if self._identity() != self.identity:
                return False
            self.process.stdin.write('check\n')
            self.process.stdin.flush()
            return self._read() == 'held' and self.process.poll() is None and self._identity() == self.identity
        except (OSError, ValueError, TimeoutError):
            return False

    def release(self):
        process, self.process = self.process, None
        if process is None:
            return
        try:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=self.timeout)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        finally:
            process.stdin.close()
            process.stdout.close()
