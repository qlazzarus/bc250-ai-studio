#!/usr/bin/env python3
"""Reject release archives missing any Studio generation safety candidate."""
import hashlib
import importlib.util
import io
import tarfile
import tempfile
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/verify-release-candidate.py'
spec = importlib.util.spec_from_file_location('fixture_release_verifier', path)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
GENERATION_FILES = (
    'deploy/model-control/old-studio-process-watch.py',
    'deploy/model-control/studio-generation-boundary.py',
    'deploy/model-control/studio-process-observer.py',
)


class RequiredGenerationTest(unittest.TestCase):
    def make_archive(self, root, missing=None):
        target = Path(root) / 'candidate.tar.gz'
        with tarfile.open(target, 'w:gz') as archive:
            for name in sorted(verifier.REQUIRED - {missing}):
                data = (('a' * 40 + '\n').encode() if name == 'COMMIT' else b'fixture\n')
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        return target, hashlib.sha256(target.read_bytes()).hexdigest()

    def test_complete_and_each_missing_generation_file(self):
        self.assertTrue(set(GENERATION_FILES).issubset(verifier.REQUIRED))
        with tempfile.TemporaryDirectory() as directory:
            archive, digest = self.make_archive(directory)
            verifier.verify(archive, digest, 'a' * 40)
            for missing in GENERATION_FILES:
                with self.subTest(missing=missing):
                    archive, digest = self.make_archive(directory, missing)
                    with self.assertRaises(ValueError):
                        verifier.verify(archive, digest, 'a' * 40)


if __name__ == '__main__':
    unittest.main()
