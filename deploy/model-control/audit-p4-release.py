#!/usr/bin/env python3
"""Read-only P4 release comparison. Not an installer or safety authorization."""
import hashlib
import tarfile
from pathlib import Path, PurePosixPath

# Only these application changes were observed for the reviewed P4 release.
ALLOWED_APP_CHANGES = frozenset({
    'backend/app/api/routes.py',
    'backend/app/models/schemas.py',
    'backend/app/services/registry.py',
})
PINNED_FILES = ('pyproject.toml', 'uv.lock', 'config/models.yaml')
MAX_MEMBER = 32 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024


def audit(archive, app, expected_sha256):
    """Return sorted differences after validating the explicitly pinned archive.

    This does not establish archive provenance or prevent changes after reading.
    The caller must independently trust the expected SHA-256.
    """
    archive, app = Path(archive), Path(app)
    if len(expected_sha256) != 64 or any(c not in '0123456789abcdef' for c in expected_sha256):
        raise ValueError('Invalid expected SHA-256')
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != expected_sha256:
            raise ValueError('Release hash mismatch')
        stream.seek(0)
        files = {}
        total = 0
        with tarfile.open(fileobj=stream, mode='r:gz') as tar:
            for member in tar:
                name = member.name.removeprefix('./')
                path = PurePosixPath(name)
                if not name or path.is_absolute() or '..' in path.parts:
                    raise ValueError('Invalid release path')
                if member.isdir():
                    continue
                if not member.isfile() or name in files or member.size > MAX_MEMBER:
                    raise ValueError('Unsupported, duplicate or oversized release member')
                total += member.size
                if total > MAX_TOTAL:
                    raise ValueError('Release exceeds size limit')
                source = tar.extractfile(member)
                if source is None:
                    raise ValueError('Unreadable release member')
                files[name] = hashlib.sha256(source.read()).hexdigest()
    current = {}
    backend = app / 'backend'
    if not backend.is_dir() or backend.is_symlink():
        raise ValueError('Installed backend missing or symlinked')
    for path in backend.rglob('*'):
        if '__pycache__' in path.parts or path.suffix == '.pyc':
            continue
        if path.is_symlink():
            raise ValueError('Symlink in installed backend')
        if path.is_file():
            name = path.relative_to(app).as_posix()
            current[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    for name in PINNED_FILES:
        path = app / name
        if not path.is_file() or path.is_symlink():
            raise ValueError('Installed pinned file missing or symlinked')
        current[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    relevant = {name: digest for name, digest in files.items()
                if name.startswith('backend/') or name in PINNED_FILES}
    changes = sorted(name for name in set(current) | set(relevant)
                     if current.get(name) != relevant.get(name))
    unexpected = [name for name in changes if name.startswith('backend/app/')
                  and name not in ALLOWED_APP_CHANGES]
    unexpected += [name for name in PINNED_FILES if name in changes]
    if unexpected:
        raise ValueError('Unexpected runtime or pinned file changes: ' + ', '.join(unexpected))
    return changes
