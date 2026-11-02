#!/usr/bin/env python3
"""Focused artifact/tree comparison tests with temporary, non-root fixtures."""
import hashlib
import importlib.util
import io
import os
import stat
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1] / 'deploy/model-control'
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
module = load('staged_release', BASE / 'verify-staged-release.py')
archive_verifier = load('archive_verifier', BASE / 'verify-release-candidate.py')


class StagedReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.root = base / 'release'
        self.root.mkdir()
        self.archive = base / 'release.tar.gz'
        self.commit = 'a' * 40
        with tarfile.open(self.archive, 'w:gz') as tar:
            for name in sorted(archive_verifier.REQUIRED):
                if name == 'COMMIT':
                    data = (self.commit + '\n').encode()
                elif name == module.VERIFIER:
                    data = (BASE / 'verify-release-candidate.py').read_bytes()
                else:
                    data = b'fixture\n'
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                member = tarfile.TarInfo(name)
                member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
        self.digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        with patch.object(module.os, 'geteuid', return_value=0):
            self.check = module.StagedReleaseCheck(self.archive, self.root, self.commit, self.digest)

    def run_check(self):
        # Root ownership is tested separately in the Fedora VM.
        def fixture_trusted(path, *, directory=False):
            if path.is_symlink() or (not path.is_dir() if directory else not path.is_file()):
                raise ValueError('fixture path')
        def fixture_entry(path):
            if stat.S_ISLNK(path.lstat().st_mode):
                raise ValueError('fixture symlink')
        with patch.object(module.os, 'geteuid', return_value=0), \
             patch.object(module, 'trusted', side_effect=fixture_trusted), \
             patch.object(module, 'check_tree_entry', side_effect=fixture_entry):
            return self.check(self.commit, self.digest)

    def test_equal_tree(self):
        self.assertTrue(self.run_check())

    def test_modified_file_is_rejected(self):
        (self.root / 'backend/app/main.py').write_text('changed')
        with self.assertRaises(ValueError):
            self.run_check()

    def test_extra_file_is_rejected(self):
        (self.root / 'backend/app/unexpected.py').write_text('extra')
        with self.assertRaises(ValueError):
            self.run_check()

    def test_verifier_tampering_is_rejected_before_import(self):
        with (self.root / module.VERIFIER).open('a') as file:
            file.write('\nraise AssertionError("must not execute")\n')
        with self.assertRaises(ValueError):
            self.run_check()

    def test_symlink_is_rejected(self):
        path = self.root / 'backend/app/main.py'
        path.unlink()
        os.symlink(self.root / 'COMMIT', path)
        with self.assertRaises(ValueError):
            self.run_check()


if __name__ == '__main__':
    unittest.main()
