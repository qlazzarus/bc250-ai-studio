import os
import stat
import subprocess
import sys
from types import SimpleNamespace

import pytest
from app.core.files import FileLock, LockBusyError


def info(mode, uid=0, nlink=1):
    return SimpleNamespace(st_mode=mode, st_uid=uid, st_nlink=nlink)


def test_trusted_path_metadata_validation():
    FileLock._check_trusted_directory(info(stat.S_IFDIR | 0o750))
    FileLock._check_trusted_file(info(stat.S_IFREG | 0o660))
    for item in [info(stat.S_IFDIR | 0o770), info(stat.S_IFDIR | 0o750, uid=1000)]:
        with pytest.raises(RuntimeError):
            FileLock._check_trusted_directory(item)
    for item in [info(stat.S_IFREG | 0o666), info(stat.S_IFREG | 0o660, uid=1000),
                 info(stat.S_IFREG | 0o660, nlink=2), info(stat.S_IFDIR | 0o660)]:
        with pytest.raises(RuntimeError):
            FileLock._check_trusted_file(item)


def test_precreated_lock_contention_and_no_creation(tmp_path, monkeypatch):
    # Unprivileged CI cannot create root-owned paths; metadata checks are tested
    # separately, while the real OS opens and flocks these files.
    monkeypatch.setattr(FileLock, "_check_trusted_directory", staticmethod(lambda info: None))
    monkeypatch.setattr(FileLock, "_check_trusted_file", staticmethod(lambda info: None))
    path = tmp_path / "gpu.lock"
    with pytest.raises(FileNotFoundError):
        FileLock(path, secure_precreated=True).acquire()
    path.touch(mode=0o660)
    first = FileLock(path, secure_precreated=True)
    second = FileLock(path, secure_precreated=True)
    first.acquire()
    try:
        with pytest.raises(LockBusyError):
            second.acquire()
    finally:
        first.release()
    second.acquire()
    second.release()


def test_precreated_lock_refuses_symlink(tmp_path, monkeypatch):
    monkeypatch.setattr(FileLock, "_check_trusted_directory", staticmethod(lambda info: None))
    target = tmp_path / "target"
    target.touch()
    path = tmp_path / "gpu.lock"
    path.symlink_to(target)
    with pytest.raises(OSError):
        FileLock(path, secure_precreated=True).acquire()
    assert os.path.islink(path)


def test_secure_lock_excludes_another_process(tmp_path, monkeypatch):
    monkeypatch.setattr(FileLock, "_check_trusted_directory", staticmethod(lambda info: None))
    monkeypatch.setattr(FileLock, "_check_trusted_file", staticmethod(lambda info: None))
    path = tmp_path / "gpu.lock"
    path.touch()
    lock = FileLock(path, secure_precreated=True)
    lock.acquire()
    try:
        code = (
            "import fcntl, sys; f = open(sys.argv[1], 'r+'); "
            "fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)"
        )
        result = subprocess.run([sys.executable, "-c", code, str(path)], capture_output=True)
        assert result.returncode != 0
        assert b"BlockingIOError" in result.stderr
    finally:
        lock.release()
    assert subprocess.run([sys.executable, "-c", code, str(path)], capture_output=True).returncode == 0
