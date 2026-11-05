#!/usr/bin/env python3
"""Observe selected process references to a DB tree; this does not fence writers.

The caller must supply a PID and trusted paths. This does not enumerate other
processes, stop new opens, or establish safe deployment.
"""
import os
import re
import stat
from pathlib import Path

PROC = Path('/proc')


def watched_paths(data_root, database):
    root, db = Path(data_root), Path(database)
    if not root.is_absolute() or not db.is_absolute() or '..' in root.parts or '..' in db.parts:
        raise ValueError('절대 경로가 필요합니다.')
    relative = db.relative_to(root)
    if not relative.parts or db.name in {'.', '..'}:
        raise ValueError('데이터베이스 경로가 올바르지 않습니다.')
    directories = [root]
    for part in relative.parts[:-1]:
        directories.append(directories[-1] / part)
    targets = []
    for path in directories:
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError('데이터 경로의 디렉터리가 올바르지 않습니다.')
        targets.append((str(path), info.st_dev, info.st_ino))
    for path in (db, *(Path(str(db) + suffix) for suffix in ('-wal', '-shm', '-journal'))):
        try:
            info = path.lstat()
        except FileNotFoundError:
            targets.append((str(path), None, None))
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('데이터베이스 파일이 단일 링크의 일반 파일이 아닙니다.')
        targets.append((str(path), info.st_dev, info.st_ino))
    if targets[len(directories)][1] is None:
        raise ValueError('데이터베이스가 없습니다.')
    return tuple(targets)


def process_starttime(pid):
    text = (PROC / str(pid) / 'stat').read_text(encoding='ascii')
    end = text.rfind(')')
    values = text[end + 1:].split() if end >= 0 else []
    if len(values) <= 19 or not values[19].isdecimal():
        raise ValueError('프로세스 시작 시각 오류')
    return values[19]


def mapped_entries(text):
    if not isinstance(text, str) or not text.strip():
        raise ValueError('프로세스 메모리 매핑이 비어 있습니다.')
    result = []
    for line in text.splitlines():
        fields = line.split(maxsplit=5)
        if (len(fields) < 5 or not re.fullmatch(r'[0-9a-fA-F]+-[0-9a-fA-F]+', fields[0])
                or not re.fullmatch(r'[r-][w-][x-][ps]', fields[1])
                or not re.fullmatch(r'[0-9a-fA-F]+', fields[2])
                or not re.fullmatch(r'[0-9a-fA-F]+:[0-9a-fA-F]+', fields[3])
                or not fields[4].isdecimal()):
            raise ValueError('프로세스 메모리 매핑 형식 오류')
        major, minor = (int(value, 16) for value in fields[3].split(':'))
        inode = int(fields[4])
        if inode:
            result.append((fields[0], os.makedev(major, minor), inode))
    return result


def mapped_inodes(text):
    return {(device, inode) for _, device, inode in mapped_entries(text)}


def classify_mappings(pid, entries, watched):
    watched_inodes = {inode for _, inode in watched}
    uncertain = False
    for address, device, inode in entries:
        if (device, inode) in watched:
            return 'mapping'
        if inode not in watched_inodes:
            continue
        # Some filesystems report different device IDs in stat and maps.
        # Resolve the actual mapped object; failure is uncertainty, not absence.
        try:
            info = (PROC / str(pid) / 'map_files' / address).stat()
        except OSError:
            uncertain = True
            continue
        if (info.st_dev, info.st_ino) in watched:
            return 'mapping'
        uncertain = True
    return 'mapping-ambiguous' if uncertain else None


def observe_process(pid, data_root, database):
    if os.geteuid() != 0 or type(pid) is not int or pid <= 1:
        raise ValueError('root와 유효한 PID가 필요합니다.')
    watched = watched_paths(data_root, database)
    inodes = {(device, inode) for _, device, inode in watched if device is not None}
    started = process_starttime(pid)
    process = PROC / str(pid)
    found = set()
    for path in (process / 'cwd', process / 'root'):
        info = path.stat()
        if (info.st_dev, info.st_ino) in inodes:
            found.add(path.name)
    for entry in (process / 'fd').iterdir():
        if not entry.name.isdecimal():
            raise ValueError('파일 디스크립터 형식 오류')
        info = entry.stat()
        if (info.st_dev, info.st_ino) in inodes:
            found.add('fd')
    mapped = mapped_entries((process / 'maps').read_text(encoding='utf-8', errors='surrogateescape'))
    classification = classify_mappings(pid, mapped, inodes)
    if classification:
        found.add(classification)
    watched_inodes = {inode for _, inode in inodes}
    after = mapped_entries((process / 'maps').read_text(encoding='utf-8', errors='surrogateescape'))
    if ({entry for entry in mapped if entry[2] in watched_inodes}
            != {entry for entry in after if entry[2] in watched_inodes}):
        raise ValueError('검사 중 데이터베이스 매핑이 변경됐습니다.')
    if process_starttime(pid) != started or watched_paths(data_root, database) != watched:
        raise ValueError('검사 중 프로세스 또는 데이터 경로가 변경됐습니다.')
    return frozenset(found)


def observe_known_processes(pids, data_root, database):
    """Observe only the explicitly supplied PIDs; incomplete lists are not safe."""
    if (not isinstance(pids, (tuple, list)) or not pids or
            any(type(pid) is not int or pid <= 1 for pid in pids) or len(set(pids)) != len(pids)):
        raise ValueError('중복 없는 시험 PID 목록이 필요합니다.')
    watched = watched_paths(data_root, database)
    starts = {pid: process_starttime(pid) for pid in pids}
    results = {pid: observe_process(pid, data_root, database) for pid in pids}
    if watched_paths(data_root, database) != watched:
        raise ValueError('여러 프로세스 검사 중 데이터 경로가 변경됐습니다.')
    if any(process_starttime(pid) != starts[pid] for pid in pids):
        raise ValueError('여러 프로세스 검사 중 프로세스가 변경됐습니다.')
    return results
