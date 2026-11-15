#!/usr/bin/env python3
"""Build a byte-reproducible release archive from a staged release directory.

GitHub Actions rebuilds the archive on every push, so the same commit has to
produce the same bytes. Plain `tar -czf` embeds the current time in the gzip
header and in file mtimes, which makes a pinned hash match only once.
"""
import gzip
import sys
import tarfile
from pathlib import Path

ITEMS = ('pyproject.toml', 'uv.lock', 'backend', 'config', 'frontend/dist')
FIXED_MTIME = 1767225600  # 2026-01-01T00:00:00Z


def normalize(info):
    info.mtime = FIXED_MTIME
    info.uid = info.gid = 0
    info.uname = info.gname = 'root'
    info.mode = 0o755 if info.isdir() else 0o644
    return info


def members(root):
    for item in ITEMS:
        path = root / item
        if not path.exists():
            raise SystemExit(f'Missing release item: {item}')
        if path.is_file():
            yield path, item
            continue
        for child in sorted(path.rglob('*')):
            yield child, child.relative_to(root).as_posix()


def build(root, output):
    root, output = Path(root), Path(output)
    seen = set()
    with open(output, 'wb') as raw:
        # mtime=0 keeps the gzip header identical between runs.
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as gz:
            with tarfile.open(fileobj=gz, mode='w', format=tarfile.GNU_FORMAT) as tar:
                for path, name in members(root):
                    if name in seen:
                        raise SystemExit(f'Duplicate release path: {name}')
                    seen.add(name)
                    info = normalize(tar.gettarinfo(str(path), arcname=name))
                    if info.isdir():
                        tar.addfile(info)
                    elif info.isfile():
                        info.size = path.stat().st_size
                        with path.open('rb') as stream:
                            tar.addfile(info, stream)
                    else:
                        raise SystemExit(f'Unsupported release entry: {name}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(f'usage: {sys.argv[0]} STAGE_DIR OUTPUT.tar.gz')
    build(sys.argv[1], sys.argv[2])