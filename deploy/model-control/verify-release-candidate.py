#!/usr/bin/env python3
"""Inspect a pinned release candidate without extracting or installing it.

The digest and commit must come from an independently trusted Actions run.
This inspection does not make an untrusted or mutable path safe for root use.
"""

import hashlib
import os
import re
import stat
import sys
import tarfile
from pathlib import PurePosixPath

ROOTS = frozenset({'COMMIT', 'pyproject.toml', 'uv.lock', 'backend', 'config',
                   'frontend', 'deploy', 'systemd', 'docs', 'scripts'})
REQUIRED = frozenset({'COMMIT', 'pyproject.toml', 'uv.lock', 'backend/app/main.py',
                      'frontend/dist/index.html', 'deploy/model-control/prepare-code.sh',
                      'deploy/model-control/verify-release-candidate.py',
                      'deploy/model-control/verify-staged-release.py',
                      'deploy/model-control/stage-release.py',
                      'deploy/model-control/prepare-secrets.py',
                      'deploy/model-control/verify-staged-secrets.py',
                      'deploy/model-control/staged-configuration-adapter.py',
                      'deploy/model-control/coordinated-migration.py',
                      'deploy/model-control/migration-journal.py',
                      'deploy/model-control/assemble-coordinator.py',
                      'deploy/model-control/assemble-pinned-coordinator.py',
                      'deploy/model-control/prepare-state.py',
                      'deploy/model-control/start-new-services.py',
                      'deploy/model-control/install-studio-release.py',
                      'deploy/model-control/install-units.py',
                      'deploy/model-control/initial-install-adapter.py',
                      'deploy/model-control/legacy-backup-adapter.py',
                      'deploy/model-control/legacy-backup-sequence.py',
                      'deploy/model-control/legacy-rollback-sequence.py',
                      'deploy/model-control/restore-legacy-files.py',
                      'deploy/model-control/verify-backup.py',
                      'deploy/model-control/backup-stopped.sh',
                      'deploy/model-control/backup-archive.sh',
                      'deploy/model-control/check-service-cgroup.py',
                      'deploy/model-control/caddy-transaction.py',
                      'deploy/model-control/caddy-maintenance-adapter.py',
                      'deploy/model-control/capture-caddy.py',
                      'deploy/model-control/create-maintenance-caddy.py',
                      'deploy/model-control/caddy-file-swap.py',
                      'deploy/model-control/maintenance-probe.py',
                      'deploy/model-control/migrate-legacy-gate.py',
                      'deploy/model-control/preserve-new-stopped.sh',
                      'deploy/model-control/preserve-new-adapter.py',
                      'deploy/model-control/preserve-new-archive.sh',
                      'deploy/model-control/check-preserved-switch-state.py',
                      'deploy/model-control/check-new-switch-state.py',
                      'deploy/model-control/restore-backup-to-stage.sh',
                      'deploy/model-control/preserve-installed-units.py',
                      'deploy/model-control/studio.conf',
                      'deploy/model-control/gate.conf',
                      'deploy/model-control/llm-client.conf',
                      'deploy/model-control/50-bc250-studio-llm.rules',
                      'systemd/bc250-gpu-lock.conf', 'systemd/bc250-model-worker.socket',
                      'systemd/bc250-model-worker.service', 'systemd/bc250-model-api.service'})
MAX_MEMBERS = 50000
MAX_BYTES = 1024 * 1024 * 1024


def verify(path, expected_hash, expected_commit):
    if not re.fullmatch(r'[0-9a-f]{64}', expected_hash):
        raise ValueError('SHA-256 형식이 올바르지 않습니다.')
    if not re.fullmatch(r'[0-9a-f]{40}', expected_commit):
        raise ValueError('커밋 ID 형식이 올바르지 않습니다.')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as file:
        before = os.fstat(file.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise ValueError('아티팩트가 단일 링크의 일반 파일이 아닙니다.')
        if hashlib.file_digest(file, 'sha256').hexdigest() != expected_hash:
            raise ValueError('아티팩트 SHA-256이 다릅니다.')
        file.seek(0)
        names = set()
        size = 0
        with tarfile.open(fileobj=file, mode='r:gz') as archive:
            for count, member in enumerate(archive, 1):
                if count > MAX_MEMBERS:
                    raise ValueError('아카이브 항목이 너무 많습니다.')
                raw = member.name.rstrip('/')
                name = PurePosixPath(raw)
                if (not raw or raw.startswith('/') or any(p in ('', '.', '..') for p in raw.split('/'))
                        or name.parts[0] not in ROOTS or raw in names):
                    raise ValueError('아카이브 경로가 유효하지 않거나 중복됐습니다.')
                if not (member.isfile() or member.isdir()):
                    raise ValueError('링크 또는 특수 파일은 허용하지 않습니다.')
                if member.isfile():
                    size += member.size
                    if size > MAX_BYTES:
                        raise ValueError('아카이브의 압축 해제 크기가 너무 큽니다.')
                names.add(raw)
                if raw == 'COMMIT':
                    if not member.isfile() or member.size != 41:
                        raise ValueError('아티팩트 커밋 기록이 올바르지 않습니다.')
                    commit = archive.extractfile(member).read().decode('ascii')
                    if commit != expected_commit + '\n':
                        raise ValueError('아티팩트 커밋이 예상 커밋과 다릅니다.')
                elif raw in REQUIRED and not member.isfile():
                    raise ValueError('필수 항목이 일반 파일이 아닙니다.')
        if not REQUIRED.issubset(names):
            raise ValueError('필수 아티팩트 파일이 없습니다.')
        after = os.fstat(file.fileno())
        fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        if any(getattr(before, key) != getattr(after, key) for key in fields):
            raise ValueError('검사 중 아티팩트가 변경됐습니다.')


def main():
    if len(sys.argv) != 4:
        raise SystemExit('사용법: verify-release-candidate.py 아티팩트 SHA256 커밋ID')
    try:
        verify(*sys.argv[1:])
    except (OSError, UnicodeError, ValueError, tarfile.TarError) as exc:
        raise SystemExit(f'릴리스 후보 검사 실패: {exc}') from None
    print('릴리스 후보 SHA-256·커밋·구성 검사 완료; 설치하지 않았습니다.')


if __name__ == '__main__':
    main()
