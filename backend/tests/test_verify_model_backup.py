import importlib.util
import io
import tarfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/model-control/verify-backup.py'
spec = importlib.util.spec_from_file_location('verify_model_backup', SCRIPT)
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


@pytest.mark.parametrize('name', ['/etc/passwd', '../escape', 'opt/other/file'])
def test_reject_unexpected_or_escaping_path(name):
    with pytest.raises(ValueError):
        verify.archive_name(name)


def test_archive_rejects_member_inside_symlink(tmp_path, monkeypatch):
    path = tmp_path / 'legacy.tar'
    with tarfile.open(path, 'w') as archive:
        for name in verify.REQUIRED:
            entry = tarfile.TarInfo(name)
            if name in ('opt/bc250-ai-studio', 'opt/ai-studio-data'):
                entry.type = tarfile.DIRTYPE
            archive.addfile(entry)
        link = tarfile.TarInfo('opt/bc250-ai-studio/link')
        link.type = tarfile.SYMTYPE
        link.linkname = '/etc'
        archive.addfile(link)
        child = tarfile.TarInfo('opt/bc250-ai-studio/link/file')
        child.size = 1
        archive.addfile(child, io.BytesIO(b'x'))
    monkeypatch.setattr(verify, 'checked_file', lambda path: path.open('rb'))
    with pytest.raises(ValueError, match='심볼릭'):
        verify.verify_archive(tmp_path)


def test_archive_accepts_valid_symlink_leaf(tmp_path, monkeypatch):
    with tarfile.open(tmp_path / 'legacy.tar', 'w') as archive:
        for name in verify.REQUIRED:
            entry = tarfile.TarInfo(name)
            if name in ('opt/bc250-ai-studio', 'opt/ai-studio-data'):
                entry.type = tarfile.DIRTYPE
            archive.addfile(entry)
        link = tarfile.TarInfo('opt/bc250-ai-studio/python')
        link.type = tarfile.SYMTYPE
        link.linkname = '/usr/bin/python3'
        archive.addfile(link)
    monkeypatch.setattr(verify, 'checked_file', lambda path: path.open('rb'))
    verify.verify_archive(tmp_path)


def test_archive_rejects_hardlink_to_symlink(tmp_path, monkeypatch):
    with tarfile.open(tmp_path / 'legacy.tar', 'w') as archive:
        for name in verify.REQUIRED:
            entry = tarfile.TarInfo(name)
            if name in ('opt/bc250-ai-studio', 'opt/ai-studio-data'):
                entry.type = tarfile.DIRTYPE
            archive.addfile(entry)
        link = tarfile.TarInfo('opt/bc250-ai-studio/python')
        link.type = tarfile.SYMTYPE
        link.linkname = '/usr/bin/python3'
        archive.addfile(link)
        hardlink = tarfile.TarInfo('opt/bc250-ai-studio/hardlink')
        hardlink.type = tarfile.LNKTYPE
        hardlink.linkname = link.name
        archive.addfile(hardlink)
    monkeypatch.setattr(verify, 'checked_file', lambda path: path.open('rb'))
    with pytest.raises(ValueError):
        verify.verify_archive(tmp_path)


def test_archive_rejects_required_config_as_symlink(tmp_path, monkeypatch):
    with tarfile.open(tmp_path / 'legacy.tar', 'w') as archive:
        for name in verify.REQUIRED:
            entry = tarfile.TarInfo(name)
            if name in ('opt/bc250-ai-studio', 'opt/ai-studio-data'):
                entry.type = tarfile.DIRTYPE
            if name == 'etc/bc250-llm-gate.env':
                entry.type = tarfile.SYMTYPE
                entry.linkname = '/etc/shadow'
            archive.addfile(entry)
    monkeypatch.setattr(verify, 'checked_file', lambda path: path.open('rb'))
    with pytest.raises(ValueError):
        verify.verify_archive(tmp_path)
