#!/usr/bin/env python3
"""Create a new root-owned, append-only phase record for one migration.

An existing record is never reopened for continuation. A begin without a
confirmed record denotes an uncertain result requiring manual investigation.
The record contains phase names and times only, never keys or environment data.
"""
import datetime
import json
import os
import re
import stat
from pathlib import Path

PHASES = frozenset({'maintenance_enter', 'legacy_backup', 'install', 'new_start',
                    'new_confirmation', 'maintenance_restore'})
EVENTS = frozenset(f'{phase}:{state}' for phase in PHASES for state in ('begin', 'confirmed')) | {
    'await_manual_client_restart', 'complete'}


class MigrationJournal:
    def __init__(self, directory):
        directory = Path(directory)
        if os.geteuid() != 0 or not directory.is_absolute() or '..' in directory.parts:
            raise ValueError('root와 정규화된 기록 디렉터리가 필요합니다.')
        for path in (directory, *directory.parents):
            info = path.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
                    or info.st_mode & 0o022):
                raise ValueError('기록 경로를 신뢰할 수 없습니다.')
        if stat.S_IMODE(directory.stat().st_mode) != 0o700:
            raise ValueError('기록 디렉터리는 root 전용이어야 합니다.')
        self.directory = directory
        self.path = directory / 'migration-events.jsonl'
        self.fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                          os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            os.fchmod(self.fd, 0o600)
            info = os.fstat(self.fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1:
                raise ValueError('기록 파일을 신뢰할 수 없습니다.')
            os.fsync(self.fd)
            dir_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except BaseException:
            os.close(self.fd)
            self.fd = None
            raise

    def __call__(self, event):
        if self.fd is None or event not in EVENTS:
            raise ValueError('지원하지 않는 배포 기록입니다.')
        self._append({'event': event})

    def backup(self, path):
        """Record the verified legacy backup's fixed, root-private path."""
        path = Path(path)
        if (not re.fullmatch(r'/var/backups/bc250-model-migration\.[A-Za-z0-9]{8}', str(path))):
            raise ValueError('백업 경로 형식이 올바르지 않습니다.')
        for item in (path, *path.parents):
            info = item.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('백업 경로를 신뢰할 수 없습니다.')
        if stat.S_IMODE(path.stat().st_mode) != 0o700:
            raise ValueError('백업 경로는 root 전용이어야 합니다.')
        self._append({'event': 'legacy_backup:path', 'path': str(path)})

    def release(self, commit, artifact_sha256):
        """Record independently authenticated release identity before any action."""
        if (self.fd is None or os.fstat(self.fd).st_size != 0
                or not re.fullmatch(r'[0-9a-f]{40}', commit)
                or not re.fullmatch(r'[0-9a-f]{64}', artifact_sha256)):
            raise ValueError('릴리스 식별 정보 또는 기록 순서가 올바르지 않습니다.')
        self._append({'event': 'release', 'commit': commit, 'sha256': artifact_sha256})

    def _append(self, item):
        if self.fd is None:
            raise ValueError('배포 기록이 닫혔습니다.')
        info = os.fstat(self.fd)
        current = self.path.lstat()
        if ((info.st_dev, info.st_ino) != (current.st_dev, current.st_ino)
                or not stat.S_ISREG(current.st_mode) or current.st_uid != 0
                or current.st_nlink != 1 or stat.S_IMODE(current.st_mode) != 0o600
                or info.st_size > 65536):
            raise ValueError('배포 기록 파일이 변경됐습니다.')
        item['time'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        data = (json.dumps(item, separators=(',', ':')) + '\n').encode()
        offset = 0
        while offset < len(data):
            written = os.write(self.fd, data[offset:])
            if written <= 0:
                raise OSError('배포 기록을 쓰지 못했습니다.')
            offset += written
        os.fsync(self.fd)

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
