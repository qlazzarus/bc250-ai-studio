#!/usr/bin/env python3
"""Test early fail-closed paths without modifying systemd."""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/wiki-condition-fence.py'
spec = importlib.util.spec_from_file_location('condition_fence', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FenceTest(unittest.TestCase):
    def test_existing_marker_is_not_overwritten(self):
        fence = module.WikiConditionFence.__new__(module.WikiConditionFence)
        fence.record = Mock()
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            marker = base / 'marker'
            marker.mkdir()
            fence.marker_dir = marker
            fence.unit_dir = base
            with patch.object(module, 'MARKER_DIR', marker), patch.object(module, 'RUNTIME', base), \
                 patch.object(module, 'trusted'), patch.object(module.subprocess, 'run') as command:
                with self.assertRaises(ValueError):
                    fence.acquire()
            command.assert_not_called()
            fence.record.append.assert_not_called()

    def test_release_denial_keeps_fence(self):
        fence = module.WikiConditionFence.__new__(module.WikiConditionFence)
        fence.was_active = True
        fence.check = Mock()
        fence.record = Mock()
        with patch.object(module.subprocess, 'run') as command:
            with self.assertRaises(ValueError):
                fence.release(can_release=lambda: False)
        fence.check.assert_not_called()
        fence.record.append.assert_not_called()
        command.assert_not_called()

    def test_resume_requires_complete_persistent_record(self):
        with tempfile.TemporaryDirectory() as directory:
            record = Path(directory) / 'wiki-fence.jsonl'
            rows = [{'event': 'condition:begin', 'unit': module.UNIT, 'was_active': True,
                     'persistent': True, 'created_dropin_dir': False}, {'event': 'condition:confirmed'}]
            def write():
                record.write_text(''.join(json.dumps(row) + '\n' for row in rows))
                record.chmod(0o600)
            write()
            fence = module.WikiConditionFence.__new__(module.WikiConditionFence)
            fence.persistent, fence.was_active = True, None
            fence.record = SimpleNamespace(record=record)
            fence.check = Mock(return_value=True)
            original = os.fstat
            def fake_stat(fd):
                info = original(fd)
                return SimpleNamespace(**{name: getattr(info, name) for name in
                    ('st_mode', 'st_nlink', 'st_size', 'st_dev', 'st_ino', 'st_mtime_ns', 'st_ctime_ns')}, st_uid=0)
            with patch.object(module, 'trusted'), patch.object(module.os, 'fstat', side_effect=fake_stat):
                self.assertTrue(fence.resume_confirmed())
                self.assertTrue(fence.was_active)
                self.assertFalse(fence.owns_dropin_dir)
                fence.was_active = None
                rows.pop()
                write()
                with self.assertRaises(ValueError):
                    fence.resume_confirmed()


if __name__ == '__main__':
    unittest.main()
