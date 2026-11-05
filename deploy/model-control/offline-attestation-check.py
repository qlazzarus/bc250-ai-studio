#!/usr/bin/env python3
"""Fail-closed offline provenance callback candidate with externally pinned inputs.

Caller must independently establish the bootstrap hashes and trust this module.
This candidate does not itself install files, prevent network access, authorize
root execution, or provide an operational deployment entry point.
"""
import hashlib
import importlib.util
import os
import re
import stat
import sys
from pathlib import Path


def trusted_snapshot(path, *, directory=False):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('검증 경로가 올바르지 않습니다.')
    for current in (path, *path.parents):
        info = current.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('검증 경로 소유권 또는 권한이 올바르지 않습니다.')
        if current != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('검증 디렉터리가 아닙니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('검증 파일이 단일 링크 일반 파일이 아닙니다.')
    if directory:
        if path.stat().st_mode & 0o077:
            raise ValueError('검증 작업 디렉터리는 root 전용이어야 합니다.')
        return None
    fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as file:
        before = os.fstat(file.fileno())
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
        after = os.fstat(file.fileno())
    attrs = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    final = path.lstat()
    if any(getattr(before, key) != getattr(after, key) or getattr(after, key) != getattr(final, key)
           for key in attrs):
        raise ValueError('검증 파일이 읽는 도중 변경됐습니다.')
    return tuple(getattr(after, key) for key in attrs), digest


class OfflineAttestationCheck:
    def __init__(self, *, gh, verifier, artifact, bundle, trusted_root, home,
                 commit, digest, run_id, attempt, pins):
        self.paths = {key: Path(value) for key, value in {
            'gh': gh, 'verifier': verifier, 'artifact': artifact,
            'bundle': bundle, 'trusted_root': trusted_root}.items()}
        self.home = Path(home)
        self.commit, self.digest, self.run_id, self.attempt = commit, digest, run_id, attempt
        if (not re.fullmatch(r'[0-9a-f]{40}', commit) or not re.fullmatch(r'[0-9a-f]{64}', digest)
                or not re.fullmatch(r'[1-9][0-9]*', run_id)
                or not re.fullmatch(r'[1-9][0-9]*', attempt)
                or not isinstance(pins, dict) or set(pins) != set(self.paths)
                or any(not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value)
                       for value in pins.values()) or pins['artifact'] != digest):
            raise ValueError('독립적으로 확인한 실행·해시가 필요합니다.')
        self.pins = dict(pins)

    def __call__(self, commit, digest):
        if os.geteuid() != 0 or (commit, digest) != (self.commit, self.digest):
            raise ValueError('root와 일치하는 릴리스 정보가 필요합니다.')
        trusted_snapshot(self.home, directory=True)
        before = {key: trusted_snapshot(path) for key, path in self.paths.items()}
        if any(before[key][1] != self.pins[key] for key in before):
            raise ValueError('검증 도구 또는 자료 해시가 신뢰한 값과 다릅니다.')
        if not os.access(self.paths['gh'], os.X_OK):
            raise ValueError('검증 CLI를 실행할 수 없습니다.')
        spec = importlib.util.spec_from_file_location('offline_run_verifier', self.paths['verifier'])
        verifier = importlib.util.module_from_spec(spec)
        previous = sys.dont_write_bytecode
        try:
            sys.dont_write_bytecode = True
            spec.loader.exec_module(verifier)
            if trusted_snapshot(self.paths['verifier']) != before['verifier']:
                raise ValueError('검증기 로딩 중 변경됐습니다.')
            environment = {'HOME': str(self.home), 'PATH': '/usr/bin:/bin', 'LANG': 'C'}
            actual = verifier.verify(str(self.paths['gh']), self.paths['artifact'], commit,
                                     self.run_id, self.attempt, bundle=self.paths['bundle'],
                                     trusted_root=self.paths['trusted_root'], env=environment)
        finally:
            sys.dont_write_bytecode = previous
        if actual != digest or any(trusted_snapshot(path) != before[key] for key, path in self.paths.items()):
            raise ValueError('검증 중 후보 또는 검증 자료가 변경됐습니다.')
        trusted_snapshot(self.home, directory=True)
        return True
