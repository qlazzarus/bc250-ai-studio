#!/usr/bin/env python3
"""Focused intake checks with an explicitly mocked caller and directory trust."""
import hashlib
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/intake-authenticated-artifact.py'
spec = importlib.util.spec_from_file_location('intake_candidate', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IntakeTest(unittest.TestCase):
    def test_success_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            src = root/'source'
            src.write_bytes(b'candidate')
            dst = root/'dest'
            dst.mkdir()
            digest = hashlib.sha256(b'candidate').hexdigest()
            def open_source(path, _owner):
                return os.open(root, os.O_RDONLY | os.O_DIRECTORY), os.open(path, os.O_RDONLY), 'source'
            args = dict(owner=123, commit='a'*40, digest=digest, run_id='42', attempt='1',
                        verify_authorization=lambda *_: True)
            # UID-sensitive source checks are covered in the root-only VM test.
            with patch.object(module.os, 'geteuid', return_value=0), \
                 patch.object(module, 'protected_directory'), patch.object(module, 'open_source', open_source):
                args['owner'] = os.stat(src).st_uid
                if args['owner'] == 0:
                    self.skipTest('local test needs a non-root source owner')
                result = module.receive(src, dst, **args)
                self.assertEqual(result.read_bytes(), b'candidate')
                with self.assertRaises(ValueError):
                    module.receive(src, dst, **args)

    def test_missing_authorization_fails_before_filesystem_access(self):
        with patch.object(module.os, 'geteuid', return_value=0), patch.object(module, 'protected_directory') as access:
            with self.assertRaises(ValueError):
                module.receive('/missing', '/missing', owner=123, commit='a'*40, digest='b'*64,
                               run_id='42', attempt='1', verify_authorization=lambda *_: False)
            access.assert_not_called()


if __name__ == '__main__':
    unittest.main()
