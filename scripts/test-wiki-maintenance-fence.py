#!/usr/bin/env python3
"""Verify fail-stop record ordering without changing any systemd unit."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/wiki-maintenance-fence.py'
spec = importlib.util.spec_from_file_location('wiki_fence', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FenceTest(unittest.TestCase):
    def test_failed_mask_does_not_confirm(self):
        fence = module.WikiFence.__new__(module.WikiFence)
        fence.was_active = None
        events = []
        fence.append = lambda value, **_: events.append(value['event'])
        state = {'LoadState': 'loaded', 'ActiveState': 'active', 'MainPID': '42', 'Job': '',
                 'FragmentPath': '/usr/lib/systemd/system/fixture.service'}
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'RUNTIME', Path(directory)), \
             patch.object(module, 'properties', return_value=(state, '')), \
             patch.object(module.subprocess, 'run', side_effect=RuntimeError('fixture failure')):
            with self.assertRaises(RuntimeError):
                fence.acquire()
        self.assertEqual(events, ['acquire:begin'])

    def test_existing_runtime_unit_prevents_record(self):
        fence = module.WikiFence.__new__(module.WikiFence)
        events = []
        fence.append = lambda value, **_: events.append(value['event'])
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'RUNTIME', Path(directory)):
            (Path(directory) / module.UNIT).symlink_to('/dev/null')
            with self.assertRaises(ValueError):
                fence.acquire()
        self.assertEqual(events, [])

    def test_etc_fragment_is_rejected_before_mask_or_record(self):
        fence = module.WikiFence.__new__(module.WikiFence)
        state = {'LoadState': 'loaded', 'ActiveState': 'active', 'MainPID': '42', 'Job': '',
                 'FragmentPath': '/etc/systemd/system/fixture.service'}
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'RUNTIME', Path(directory)), \
             patch.object(module, 'properties', return_value=(state, '')), \
             patch.object(module.subprocess, 'run') as command:
            with self.assertRaisesRegex(ValueError, 'runtime mask'):
                fence.acquire()
        command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
