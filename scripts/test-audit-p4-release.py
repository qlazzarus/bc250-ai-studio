import hashlib
import importlib.util
import io
import tarfile
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    'audit_p4', Path(__file__).resolve().parents[1] / 'deploy/model-control/audit-p4-release.py'
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(tmp_path, changed='backend/app/api/routes.py', extra=None):
    app = tmp_path / 'app'
    names = ['pyproject.toml', 'uv.lock', 'config/models.yaml',
             'backend/app/api/routes.py', 'backend/app/services/gpu.py']
    for name in names:
        path = app / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'old')
    archive = tmp_path / 'release.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar:
        for name in names:
            data = b'new' if name == changed else b'old'
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
        if extra:
            tar.addfile(extra)
    return archive, app, hashlib.sha256(archive.read_bytes()).hexdigest()


def test_only_reviewed_p4_change_is_reported(tmp_path):
    assert module.audit(*fixture(tmp_path)) == ['backend/app/api/routes.py']


def test_unexpected_gpu_or_config_change_is_rejected(tmp_path):
    for index, name in enumerate(['backend/app/services/gpu.py', 'config/models.yaml']):
        folder = tmp_path / str(index)
        folder.mkdir()
        with pytest.raises(ValueError, match='Unexpected'):
            module.audit(*fixture(folder, changed=name))


def test_archive_identity_and_symlink_are_rejected(tmp_path):
    archive, app, _ = fixture(tmp_path)
    with pytest.raises(ValueError, match='hash mismatch'):
        module.audit(archive, app, '0' * 64)
    folder = tmp_path / 'linked'
    folder.mkdir()
    link = tarfile.TarInfo('backend/evil')
    link.type, link.linkname = tarfile.SYMTYPE, '/etc/passwd'
    with pytest.raises(ValueError, match='Unsupported'):
        module.audit(*fixture(folder, extra=link))
