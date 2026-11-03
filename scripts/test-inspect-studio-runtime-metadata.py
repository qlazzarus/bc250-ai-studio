#!/usr/bin/env python3
"""Test redacted extraction of the data-directory setting."""
import importlib.util
import unittest
from pathlib import Path

path = Path(__file__).resolve().parent / 'inspect-studio-runtime-metadata.py'
spec = importlib.util.spec_from_file_location('studio_runtime_metadata', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MetadataTest(unittest.TestCase):
    def test_path_and_missing_value(self):
        raw = b'SECRET=not-printed\0STUDIO_DATA_DIR=/opt/ai-studio-data\0'
        self.assertEqual(module.data_dir(raw, '/home/test'), Path('/opt/ai-studio-data'))
        self.assertEqual(module.data_dir(b'OTHER=value\0', '/home/test'),
                         Path('/home/test/.local/share/bc250-ai-studio'))
        self.assertIsNone(module.data_dir(b'STUDIO_DATA_DIR=relative\0', '/home/test'))
        for raw in (b'STUDIO_DATA_DIR=\0', b'STUDIO_DATA_DIR=/a\0STUDIO_DATA_DIR=/b\0'):
            with self.assertRaises(ValueError):
                module.data_dir(raw, '/home/test')


if __name__ == '__main__':
    unittest.main()
