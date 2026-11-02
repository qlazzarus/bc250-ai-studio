import importlib.util
import io
import os
import tarfile
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/model-control/verify-backup.py'
spec = importlib.util.spec_from_file_location('verify_model_backup', SCRIPT)
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


@pytest.mark.parametrize(('name', 'allowed'), [('Caddyfile.original', True), ('legacy.tar', False)])
def test_only_caddy_may_keep_readable_mode_in_private_backup(tmp_path, monkeypatch, name, allowed):
    path = tmp_path / name
    path.write_text('fixture')
    path.chmod(0o644)
    real_fstat = os.fstat

    def root_owned(fd):
        info = real_fstat(fd)
        return SimpleNamespace(st_mode=info.st_mode, st_uid=0, st_nlink=info.st_nlink)

    monkeypatch.setattr(verify.os, 'fstat', root_owned)
    if allowed:
        with verify.checked_file(path) as stream:
            assert stream.read() == b'fixture'
    else:
        with pytest.raises(ValueError):
            verify.checked_file(path)


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


def test_optional_dropin_requires_directory_root(tmp_path, monkeypatch):
    with tarfile.open(tmp_path / 'legacy.tar', 'w') as archive:
        for name in verify.REQUIRED:
            entry = tarfile.TarInfo(name)
            if name in ('opt/bc250-ai-studio', 'opt/ai-studio-data'):
                entry.type = tarfile.DIRTYPE
            archive.addfile(entry)
        archive.addfile(tarfile.TarInfo('etc/systemd/system/bc250-llm-gate.service.d/override.conf'))
    monkeypatch.setattr(verify, 'checked_file', lambda path: path.open('rb'))
    with pytest.raises(ValueError, match='drop-in'):
        verify.verify_archive(tmp_path)


def test_optional_dropin_directory_is_allowed(tmp_path, monkeypatch):
    with tarfile.open(tmp_path / 'legacy.tar', 'w') as archive:
        for name in verify.REQUIRED | verify.OPTIONAL_TREES:
            entry = tarfile.TarInfo(name)
            if name in ('opt/bc250-ai-studio', 'opt/ai-studio-data') or name in verify.OPTIONAL_TREES:
                entry.type = tarfile.DIRTYPE
            archive.addfile(entry)
        archive.addfile(tarfile.TarInfo('etc/systemd/system/bc250-llm-gate.service.d/override.conf'))
    monkeypatch.setattr(verify, 'checked_file', lambda path: path.open('rb'))
    verify.verify_archive(tmp_path)


def test_optional_dropin_symlink_is_rejected(tmp_path, monkeypatch):
    with tarfile.open(tmp_path / 'legacy.tar', 'w') as archive:
        for name in verify.REQUIRED | verify.OPTIONAL_TREES:
            entry = tarfile.TarInfo(name)
            if name in ('opt/bc250-ai-studio', 'opt/ai-studio-data') or name in verify.OPTIONAL_TREES:
                entry.type = tarfile.DIRTYPE
            archive.addfile(entry)
        link = tarfile.TarInfo('etc/systemd/system/bc250-llm-gate.service.d/external.conf')
        link.type = tarfile.SYMTYPE
        link.linkname = '/etc/other.conf'
        archive.addfile(link)
    monkeypatch.setattr(verify, 'checked_file', lambda path: path.open('rb'))
    with pytest.raises(ValueError, match='drop-in'):
        verify.verify_archive(tmp_path)
