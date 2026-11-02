#!/usr/bin/env python3
"""Candidate atomic file swap for a reviewed snapshot; no reload or CLI yet."""

import os
import shutil
import tempfile
from pathlib import Path


def swap(snapshot, live, generator, mode, capture):
    """Swap only a checked Caddyfile; callers must arrange ingress and reload.

    This is a building block, not an operational deployment command. Its caller
    must use trusted root-owned paths and handle reload uncertainty separately.
    """
    if mode not in {'enter', 'restore'}:
        raise ValueError('지원하지 않는 전환 단계입니다.')
    snapshot, live, generator = map(Path, (snapshot, live, generator))
    capture.verify_snapshot(snapshot, live, generator, require_current=(mode == 'enter'))
    original = snapshot / 'Caddyfile.original'
    candidate = snapshot / 'Caddyfile.maintenance'
    before = original if mode == 'enter' else candidate
    desired = candidate if mode == 'enter' else original
    old_hash = capture.digest(before)
    desired_hash = capture.digest(desired)
    saved_metadata = capture.metadata(original)
    if capture.digest(live) != old_hash or capture.metadata(live) != saved_metadata:
        raise ValueError('현재 Caddyfile이 예상 상태 또는 보호 속성과 다릅니다.')
    fd, temp_name = tempfile.mkstemp(prefix='.bc250-caddy.', dir=live.parent)
    os.close(fd)
    temp = Path(temp_name)
    print('Caddy 교체 시험 또는 임시 파일:', temp, flush=True)
    info = original.stat(follow_symlinks=False)
    os.chown(temp, info.st_uid, info.st_gid, follow_symlinks=False)
    shutil.copy2(original, temp, follow_symlinks=False)
    if capture.metadata(temp) != saved_metadata:
        raise ValueError('임시 Caddyfile 보호 속성이 원본과 다릅니다.')
    with temp.open('wb') as file:
        file.write(desired.read_bytes())
        file.flush()
        os.fsync(file.fileno())
    if capture.digest(temp) != desired_hash or capture.metadata(temp) != saved_metadata:
        raise ValueError('임시 Caddyfile 내용 또는 보호 속성이 다릅니다.')
    if capture.digest(live) != old_hash or capture.metadata(live) != saved_metadata:
        raise ValueError('교체 직전 Caddyfile이 변경됐습니다.')
    os.replace(temp, live)
    directory = os.open(live.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    if capture.digest(live) != desired_hash or capture.metadata(live) != saved_metadata:
        raise ValueError('교체된 Caddyfile 내용 또는 보호 속성이 다릅니다.')
