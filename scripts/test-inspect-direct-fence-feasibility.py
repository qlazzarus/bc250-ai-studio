#!/usr/bin/env python3
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'inspect_direct_fence', Path(__file__).with_name('inspect-direct-fence-feasibility.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FeasibilityTest(unittest.TestCase):
    def test_effective_uid_and_process_restart_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = Path(tmp)
            (proc / '123').mkdir()
            (proc / '123/status').write_text('Uid:\t1000\t1001\t1000\t1000\n')
            show = subprocess.CompletedProcess([], 0, 'LoadState=loaded\nActiveState=active\nMainPID=123\nJob=\n')
            stable = subprocess.CompletedProcess([], 0, '123\n')
            changed = subprocess.CompletedProcess([], 0, '124\n')
            with patch.object(module.subprocess, 'run', side_effect=[show, stable]):
                self.assertEqual(module.service_identity('fixture.service', proc), (123, 1001))
            with patch.object(module.subprocess, 'run', side_effect=[show, changed]):
                with self.assertRaises(ValueError):
                    module.service_identity('fixture.service', proc)

    def test_inactive_service_is_rejected(self):
        show = subprocess.CompletedProcess([], 0, 'LoadState=loaded\nActiveState=inactive\nMainPID=0\nJob=\n')
        with patch.object(module.subprocess, 'run', return_value=show):
            with self.assertRaises(ValueError):
                module.service_identity('fixture.service')

    def test_other_same_uid_processes_are_classified_by_namespace(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = Path(tmp)
            for pid, uid, ns in ((1, 0, 'net:[1]'), (10, 1001, 'net:[1]'),
                                 (11, 1001, 'net:[2]'), (12, 1002, 'net:[1]'),
                                 (13, 1001, 'net:[1]')):
                directory = proc / str(pid)
                (directory / 'ns').mkdir(parents=True)
                (directory / 'ns/net').symlink_to(ns)
                (directory / 'status').write_text(f'Uid:\t{uid}\t{uid}\t{uid}\t{uid}\n')
            self.assertEqual(module.other_same_uid_processes(1001, {13}, proc), (1, 1, 0, 0))


if __name__ == '__main__':
    unittest.main()
