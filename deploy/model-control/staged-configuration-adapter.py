#!/usr/bin/env python3
"""Pinned, root-owned staged-configuration checker for an internal coordinator.

The digest must be obtained from a previously authenticated release. The
checker has no command-line arguments, and reads its fixed configuration path.
There is deliberately no deployment CLI or bypass on verification failure.
"""
import hashlib
import os
import re
import stat
import subprocess
from pathlib import Path


class ConfigurationCheck:
    def __init__(self, checker, expected_sha256):
        self.checker = Path(checker)
        self.expected = expected_sha256
        if (os.geteuid() != 0 or not self.checker.is_absolute()
                or '..' in self.checker.parts or self.checker.name != 'verify-staged-secrets.py'
                or not re.fullmatch(r'[0-9a-f]{64}', self.expected)):
            raise ValueError('root와 검증된 설정 검사기 경로·해시가 필요합니다.')

    def verify_file(self):
        for path in (self.checker, *self.checker.parents):
            info = path.lstat()
            if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
                raise ValueError('설정 검사기 경로를 신뢰할 수 없습니다.')
            if path != self.checker and not stat.S_ISDIR(info.st_mode):
                raise ValueError('설정 검사기 상위 경로가 디렉터리가 아닙니다.')
        fd = os.open(self.checker, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        with os.fdopen(fd, 'rb') as file:
            info = os.fstat(file.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                    or info.st_mode & 0o022 or info.st_size > 1024 * 1024):
                raise ValueError('설정 검사기 파일을 신뢰할 수 없습니다.')
            if hashlib.file_digest(file, 'sha256').hexdigest() != self.expected:
                raise ValueError('설정 검사기 해시가 릴리스와 다릅니다.')

    def __call__(self):
        self.verify_file()
        result = subprocess.run(['/usr/bin/python3', '-I', str(self.checker)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=30, check=False)
        self.verify_file()
        if result.returncode != 0:
            raise ValueError('신규 설정 검사를 통과하지 못했습니다.')
        return True
