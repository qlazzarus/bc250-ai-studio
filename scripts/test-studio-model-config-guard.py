#!/usr/bin/env python3
"""Exercise the installation guard without exposing configuration contents."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/install-studio-release.py'
spec = importlib.util.spec_from_file_location('studio_installer', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConfigGuardTest(unittest.TestCase):
    def test_equal_changed_and_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, current = root / 'source', root / 'current'
            source.write_text('fixture')
            current.write_text('fixture')
            module.require_same_model_config(source, current)
            current.write_text('changed')
            with self.assertRaises(ValueError):
                module.require_same_model_config(source, current)
            current.unlink()
            current.symlink_to(source)
            with self.assertRaises(OSError):
                module.require_same_model_config(source, current)


if __name__ == '__main__':
    unittest.main()
