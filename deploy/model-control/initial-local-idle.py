#!/usr/bin/env python3
"""Initial migration idle candidate; the external caller must maintain fences.

This combines the known Wiki fence with the real llama observer. Other direct
callers and GPU use require separately enforced, continuously checked controls.
This helper establishes none of those controls and has no operational CLI.
"""
import importlib.util
import os
import stat
import sys
from pathlib import Path


def trusted(path, *, directory=False):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('검사 도구 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('검사 도구 경로를 신뢰할 수 없습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('검사 도구 디렉터리가 아닙니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('검사 도구가 단일 링크의 파일이 아닙니다.')


class InitialLocalIdle:
    def __init__(self, source, *, check_wiki, check_other_callers, check_gpu, llama_key):
        if (os.geteuid() != 0 or not all(callable(value) for value in
                (check_wiki, check_other_callers, check_gpu, llama_key))):
            raise ValueError('root 및 차단·GPU·인증 검사기가 필요합니다.')
        self.source = Path(source)
        trusted(self.source, directory=True)
        self.observer_path = self.source / 'observe-direct-llm.py'
        self.guard = self.source / 'backup-archive.sh'
        self.cgroup = self.source / 'check-service-cgroup.py'
        for path in (self.observer_path, self.guard, self.cgroup):
            trusted(path)
        spec = importlib.util.spec_from_file_location('initial_idle_observer', self.observer_path)
        self.observer = importlib.util.module_from_spec(spec)
        previous = sys.dont_write_bytecode
        try:
            sys.dont_write_bytecode = True
            spec.loader.exec_module(self.observer)
        finally:
            sys.dont_write_bytecode = previous
        self.wiki, self.callers, self.gpu, self.key = check_wiki, check_other_callers, check_gpu, llama_key

    def __call__(self):
        for path in (self.observer_path, self.guard, self.cgroup):
            trusted(path)
        if self.wiki() is not True or self.callers() is not True:
            raise ValueError('직접 호출 차단이 확인되지 않았습니다.')
        key = self.key()
        if not isinstance(key, str):
            raise ValueError('llama 인증 정보를 확인하지 못했습니다.')
        if self.observer.observe(self.guard, llama_key=key) is not True:
            raise ValueError('llama 상태가 확인되지 않았습니다.')
        if self.gpu() is not True or self.wiki() is not True or self.callers() is not True:
            raise ValueError('GPU 유휴 또는 직접 호출 차단이 확인되지 않았습니다.')
        return True
