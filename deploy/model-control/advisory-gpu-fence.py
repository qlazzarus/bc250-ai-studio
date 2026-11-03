#!/usr/bin/env python3
"""Hold one trusted, pre-existing cooperative GPU flock; internal candidate only.

A held flock excludes only participants using this same inode and lock protocol.
It does not establish GPU idleness, stop llama-server, or fence direct callers.
No file is created or replaced. Failure leaves a held descriptor for inspection.
"""
import fcntl
import os
import stat
from pathlib import Path


class AdvisoryGPUFence:
    def __init__(self, path, *, group_id):
        self.path = Path(path)
        if (os.geteuid() != 0 or not self.path.is_absolute() or '..' in self.path.parts
                or type(group_id) is not int or group_id < 0):
            raise ValueError('root와 정규화된 잠금 경로 및 그룹이 필요합니다.')
        self.group_id = group_id
        self.fd = None
        self.identity = None

    def check_parents(self):
        for parent in self.path.parents:
            info = parent.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
                    or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022):
                raise ValueError('GPU 잠금 상위 경로를 신뢰할 수 없습니다.')

    def check_file(self, info):
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != self.group_id
                or info.st_nlink != 1 or info.st_mode & 0o007):
            raise ValueError('GPU 잠금 파일을 신뢰할 수 없습니다.')

    def acquire(self):
        if self.fd is not None:
            raise ValueError('GPU 잠금이 이미 열려 있습니다.')
        self.check_parents()
        fd = os.open(self.path, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            self.check_file(info)
            current = self.path.lstat()
            self.check_file(current)
            if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
                raise ValueError('GPU 잠금 파일이 변경됐습니다.')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(fd)
            raise
        self.fd = fd
        self.identity = (info.st_dev, info.st_ino)
        # If validation fails here, retain the lock until explicit release.
        self.check()
        return True

    def check(self):
        if self.fd is None:
            raise ValueError('GPU 잠금을 보유하지 않았습니다.')
        self.check_parents()
        opened, current = os.fstat(self.fd), self.path.lstat()
        self.check_file(opened)
        self.check_file(current)
        if ((opened.st_dev, opened.st_ino) != self.identity
                or (current.st_dev, current.st_ino) != self.identity):
            raise ValueError('GPU 잠금 경로가 변경됐습니다.')
        return True

    def release(self):
        if self.fd is None:
            raise ValueError('GPU 잠금을 보유하지 않았습니다.')
        fd = self.fd
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
        self.fd = None
        self.identity = None
