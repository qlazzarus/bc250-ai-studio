#!/usr/bin/env python3
"""Bind an authenticated artifact and immutable staged tree to the coordinator.

This is an internal candidate, not an executable deployment entry point. The
bootstrap checker hash and artifact identity must be independently trusted.
All deployment, health and local-quiescence callbacks remain mandatory.
"""
import contextlib
import hashlib
import importlib.util
import os
import re
import stat
import sys
from pathlib import Path


@contextlib.contextmanager
def no_bytecode():
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        yield
    finally:
        sys.dont_write_bytecode = previous


def trusted_file(path):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('신뢰할 수 없는 부트스트랩 경로입니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('부트스트랩 경로를 신뢰할 수 없습니다.')
        if item != path and not stat.S_ISDIR(info.st_mode):
            raise ValueError('부트스트랩 상위 경로가 디렉터리가 아닙니다.')
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1024 * 1024:
        raise ValueError('부트스트랩 파일이 올바르지 않습니다.')


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NoBytecodeRunner:
    """Keep the authenticated staged tree unchanged across the operator pause."""
    def __init__(self, runner):
        self.runner = runner

    @property
    def phase(self):
        return self.runner.phase

    def prepare_and_start(self):
        with no_bytecode():
            return self.runner.prepare_and_start()

    def finish_after_client_restart(self):
        with no_bytecode():
            return self.runner.finish_after_client_restart()


def assemble(*, root, archive, bootstrap_checker, bootstrap_sha256, snapshot, journal_dir,
             commit, artifact_sha256, expected_client_user, preflight, check_local_idle,
             check_restored, install, verify_new, verify_restored):
    if (os.geteuid() != 0 or not re.fullmatch(r'[0-9a-f]{64}', bootstrap_sha256)):
        raise ValueError('root와 독립적으로 신뢰한 검사기 해시가 필요합니다.')
    root, bootstrap = Path(root), Path(bootstrap_checker)
    trusted_file(bootstrap)
    with bootstrap.open('rb') as file:
        before = os.fstat(file.fileno())
        if hashlib.file_digest(file, 'sha256').hexdigest() != bootstrap_sha256:
            raise ValueError('부트스트랩 검사기 해시가 다릅니다.')
    with no_bytecode():
        checker_module = load('trusted_staged_release', bootstrap)
        after = bootstrap.lstat()
        attributes = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        if any(getattr(before, name) != getattr(after, name) for name in attributes):
            raise ValueError('부트스트랩 검사기 로딩 중 파일이 변경됐습니다.')
        checker = checker_module.StagedReleaseCheck(archive, root, commit, artifact_sha256)
        checker(commit, artifact_sha256)
        source = root / 'deploy/model-control'
        settings_checker = source / 'verify-staged-secrets.py'
        trusted_file(settings_checker)
        with settings_checker.open('rb') as file:
            settings_sha256 = hashlib.file_digest(file, 'sha256').hexdigest()
        assemble_module = load('verified_coordinator_assembler', source / 'assemble-coordinator.py')
        runner, journal = assemble_module.assemble(
            source=source, snapshot=snapshot, journal_dir=journal_dir, commit=commit,
            artifact_sha256=artifact_sha256, checker_sha256=settings_sha256,
            expected_client_user=expected_client_user, verify_release=checker,
            preflight=preflight, check_local_idle=check_local_idle, check_restored=check_restored,
            install=install, verify_new=verify_new, verify_restored=verify_restored)
    return NoBytecodeRunner(runner), journal
