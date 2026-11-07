import fcntl
import json
import os
from pathlib import Path


class FileLock:
    def __init__(self, path):
        self.path = Path(path)
        self.handle = None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        handle = self.path.open("a+")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.close()
            raise RuntimeError(f"Another process owns lock: {self.path}") from None
        self.handle = handle

    def release(self):
        if self.handle:
            fcntl.flock(self.handle, fcntl.LOCK_UN)
            self.handle.close()
            self.handle = None


def safe_path(root, relative):
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if path == root or root not in path.parents:
        raise ValueError("Path escapes data directory")
    return path


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.flush()
        os.fsync(file.fileno())
    temporary.replace(path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
