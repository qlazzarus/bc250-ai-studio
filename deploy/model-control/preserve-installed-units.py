#!/usr/bin/env python3
"""Move newly installed files aside using a root-private install manifest.

No service is stopped, disabled, reloaded or started here. The caller must
verify stopped services and disable their enablement before using this helper.
"""

import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path


def preserve(live_root, manifest_dir, displaced, installer_path):
    live_root, manifest_dir, displaced, installer_path = map(
        Path, (live_root, manifest_dir, displaced, installer_path))
    spec = importlib.util.spec_from_file_location('trusted_unit_installer', installer_path)
    module = importlib.util.module_from_spec(spec)
    # The coordinator must already run this helper and installer from a trusted
    # root-owned release; validate before executing any other release module.
    from stat import S_ISDIR, S_ISLNK, S_ISREG

    for path in (installer_path, *installer_path.parents):
        info = path.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or S_ISLNK(info.st_mode):
            raise ValueError('설치 도구 경로가 신뢰할 수 없습니다.')
        if path != installer_path and not S_ISDIR(info.st_mode):
            raise ValueError('설치 도구 상위 경로가 올바르지 않습니다.')
    if not S_ISREG(installer_path.lstat().st_mode) or installer_path.lstat().st_nlink != 1:
        raise ValueError('설치 도구 형식이 올바르지 않습니다.')
    spec.loader.exec_module(module)
    module.trusted(live_root, directory=True)
    module.trusted(manifest_dir, directory=True)
    module.trusted(displaced, directory=True)
    if manifest_dir.stat().st_mode & 0o077 or displaced.stat().st_mode & 0o077:
        raise ValueError('기록 또는 보존 경로는 root 전용이어야 합니다.')
    if any(displaced.iterdir()):
        raise ValueError('신규 unit 보존 경로가 비어 있지 않습니다.')
    manifest_path = manifest_dir / 'new-unit-install.json'
    module.trusted(manifest_path, directory=False)
    if manifest_path.stat().st_mode & 0o077 or manifest_path.stat().st_size > 65536:
        raise ValueError('설치 기록이 올바르지 않습니다.')
    record = json.loads(manifest_path.read_text(encoding='utf-8'))
    expected = set(module.FILES.values())
    if (not isinstance(record, dict) or set(record) != {'version', 'files', 'absent_before_install', 'created_directories'}
            or record['version'] != 1 or not isinstance(record['files'], dict)
            or set(record['files']) != expected
            or sorted(record['absent_before_install']) != sorted(expected)
            or not isinstance(record['created_directories'], list)
            or not set(record['created_directories']).issubset(module.DROPINS)
            or any(not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest)
                   for digest in record['files'].values())):
        raise ValueError('설치 기록 내용이 올바르지 않습니다.')
    present = []
    for name, digest in record['files'].items():
        target = live_root / name
        if target.parent.is_symlink():
            raise ValueError('신규 unit 상위 경로가 링크입니다.')
        if not target.parent.exists() and str(target.parent.relative_to(live_root)) in module.DROPINS:
            continue
        module.trusted(target.parent, directory=True)
        if target.parent.stat().st_dev != displaced.stat().st_dev:
            raise ValueError('보존 경로와 unit 경로가 다른 파일 시스템입니다.')
        if target.is_symlink():
            raise ValueError('신규 unit 경로가 링크입니다.')
        if not target.exists():
            continue
        module.trusted(target, directory=False)
        with target.open('rb') as file:
            if hashlib.file_digest(file, 'sha256').hexdigest() != digest:
                raise ValueError('설치 후 변경된 unit 파일이 있습니다.')
        present.append((name, target))
    for name, target in present:
        destination = displaced / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() or destination.is_symlink():
            raise ValueError('unit 보존 대상이 이미 있습니다.')
        os.rename(target, destination)
        module.sync_dir(target.parent)
        module.sync_dir(destination.parent)
    return displaced
