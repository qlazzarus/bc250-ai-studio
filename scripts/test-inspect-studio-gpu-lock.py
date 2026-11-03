#!/usr/bin/env python3
"""Check redacted path and file classification without accessing production."""
import importlib.util
import stat
import unittest
from pathlib import Path
from types import SimpleNamespace

path = Path(__file__).resolve().parent / 'inspect-studio-gpu-lock.py'
spec = importlib.util.spec_from_file_location('gpu_lock_inspect', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GpuLockMetadataTest(unittest.TestCase):
    def test_setting_selection(self):
        self.assertEqual(module.classify(b'STUDIO_DATA_DIR=/opt/ai-studio-data\0', '/tmp'), 'legacy')
        self.assertEqual(module.classify(b'STUDIO_GPU_LOCK_PATH=/run/bc250-gpu/gpu.lock\0', '/tmp'), 'new')
        self.assertEqual(module.classify(b'STUDIO_GPU_LOCK_PATH=/opt/other/lock\0', '/tmp'), 'other')
        self.assertEqual(module.classify(b'STUDIO_GPU_LOCK_PATH=/opt/../other\0', '/tmp'), 'unknown')
        with self.assertRaises(ValueError):
            module.configured_path(b'STUDIO_GPU_LOCK_PATH=\0', '/tmp')

    def test_file_types(self):
        self.assertEqual(module.file_kind(None), '없음')
        self.assertEqual(module.file_kind(SimpleNamespace(st_mode=stat.S_IFLNK)), '심볼릭 링크')
        self.assertEqual(module.file_kind(SimpleNamespace(st_mode=stat.S_IFREG)), '일반 파일')
        self.assertEqual(module.file_kind(SimpleNamespace(st_mode=stat.S_IFDIR)), '그 외 파일')
        self.assertIsNone(module.parents_match_candidate(None))


if __name__ == '__main__':
    unittest.main()
