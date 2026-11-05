#!/usr/bin/env python3
"""Experimental SQLite WAL reservation; not a usable database fence.

Raw file writes, privileged processes, replacement races and non-SQLite data
need independent controls. Closing another descriptor for the WAL shared-memory
file in this process can drop the reservation without ending the transaction.
"""
import sqlite3
import stat
from pathlib import Path


class SQLiteWriterGuard:
    def __init__(self, database):
        self.path = Path(database)
        if not self.path.is_absolute() or '..' in self.path.parts:
            raise ValueError('DB 절대 경로가 필요합니다.')
        self.connection = None
        self.identity = None

    def _identity(self):
        info = self.path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('단일 링크의 일반 DB 파일이 필요합니다.')
        return info.st_dev, info.st_ino

    def acquire(self):
        if self.connection is not None or self.identity is not None:
            raise ValueError('시험 잠금을 재사용할 수 없습니다.')
        identity = self._identity()
        connection = sqlite3.connect(self.path.as_uri() + '?mode=rw', uri=True, timeout=0,
                                     isolation_level=None)
        try:
            if connection.execute('PRAGMA journal_mode').fetchone() != ('wal',):
                raise ValueError('WAL 모드 DB가 아닙니다.')
            connection.execute('BEGIN IMMEDIATE')
            if self._identity() != identity:
                raise ValueError('잠금 획득 중 DB가 변경됐습니다.')
        except BaseException:
            connection.close()
            raise
        self.identity = identity
        self.connection = connection
        return True

    def check(self):
        # in_transaction and pathname identity do not prove a kernel lock is
        # still held. Never authorize a backup with this experimental candidate.
        return False

    def release(self):
        if self.connection is None:
            raise ValueError('보유 중인 SQLite 잠금이 없습니다.')
        connection, self.connection = self.connection, None
        try:
            connection.rollback()
        finally:
            connection.close()
