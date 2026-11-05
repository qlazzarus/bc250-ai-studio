import importlib.util
import os
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/model-control/observe-db-process-references.py'
spec = importlib.util.spec_from_file_location('observe_db_references', SCRIPT)
references = importlib.util.module_from_spec(spec)
spec.loader.exec_module(references)


def test_watched_paths_include_directories_and_optional_sqlite_files(tmp_path):
    data = tmp_path / 'data'
    parent = data / 'database'
    parent.mkdir(parents=True)
    db = parent / 'studio.sqlite3'
    db.write_bytes(b'fixture')
    result = references.watched_paths(data, db)
    assert [Path(item[0]).name for item in result] == [
        'data', 'database', 'studio.sqlite3', 'studio.sqlite3-wal',
        'studio.sqlite3-shm', 'studio.sqlite3-journal',
    ]
    assert result[0][2] == data.stat().st_ino
    assert result[1][2] == parent.stat().st_ino
    assert result[3][1:] == (None, None)


def test_watched_paths_reject_symlink_and_hardlink(tmp_path):
    data = tmp_path / 'data'
    parent = data / 'database'
    parent.mkdir(parents=True)
    db = parent / 'studio.sqlite3'
    db.write_bytes(b'fixture')
    os.link(db, parent / 'second-link')
    with pytest.raises(ValueError):
        references.watched_paths(data, db)
    (parent / 'second-link').unlink()
    db.unlink()
    db.symlink_to('/tmp/other')
    with pytest.raises(ValueError):
        references.watched_paths(data, db)


def test_mapped_inode_is_detected_without_a_file_descriptor(tmp_path):
    file = tmp_path / 'fixture'
    file.write_bytes(b'fixture')
    info = file.stat()
    major, minor = os.major(info.st_dev), os.minor(info.st_dev)
    row = f'1000-2000 rw-s 00000000 {major:02x}:{minor:02x} {info.st_ino} /path with spaces\n'
    assert (info.st_dev, info.st_ino) in references.mapped_inodes(row)
    with pytest.raises(ValueError):
        references.mapped_inodes('malformed')


def test_device_mismatch_is_verified_or_reported_as_uncertain(tmp_path, monkeypatch):
    file = tmp_path / 'fixture'
    file.write_bytes(b'fixture')
    info = file.stat()
    proc = tmp_path / 'proc'
    mapped = proc / '123' / 'map_files'
    mapped.mkdir(parents=True)
    (mapped / '1000-2000').symlink_to(file)
    monkeypatch.setattr(references, 'PROC', proc)
    watched = {(info.st_dev, info.st_ino)}
    assert references.classify_mappings(123, [('1000-2000', info.st_dev, info.st_ino)], watched) == 'mapping'
    assert references.classify_mappings(123, [('1000-2000', info.st_dev + 1, info.st_ino)], watched) == 'mapping'
    (mapped / '1000-2000').unlink()
    assert references.classify_mappings(123, [('1000-2000', info.st_dev + 1, info.st_ino)], watched) == 'mapping-ambiguous'
    assert references.classify_mappings(123, [('1000-2000', info.st_dev, info.st_ino + 1)], watched) is None


def test_known_processes_propagate_uncertainty_and_reject_changed_identity(monkeypatch):
    monkeypatch.setattr(references, 'watched_paths', lambda *_: (('fixture', 1, 2),))
    monkeypatch.setattr(references, 'process_starttime', lambda pid: str(pid))
    monkeypatch.setattr(references, 'observe_process',
                        lambda pid, *_: frozenset({'mapping-ambiguous'}) if pid == 123 else frozenset())
    result = references.observe_known_processes([123, 124], '/fixture', '/fixture/db')
    assert result[123] == {'mapping-ambiguous'} and not result[124]
    with pytest.raises(ValueError):
        references.observe_known_processes([123, 123], '/fixture', '/fixture/db')
    calls = iter(('old', 'old', 'new', 'old'))
    monkeypatch.setattr(references, 'process_starttime', lambda _: next(calls))
    with pytest.raises(ValueError):
        references.observe_known_processes([123, 124], '/fixture', '/fixture/db')
