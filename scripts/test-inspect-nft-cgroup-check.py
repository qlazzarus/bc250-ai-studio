#!/usr/bin/env python3
import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('inspect_nft_cgroup',
    Path(__file__).with_name('inspect-nft-cgroup-check.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CheckTest(unittest.TestCase):
    def test_only_check_mode_is_invoked(self):
        with patch.object(module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertTrue(module.check_expression('/usr/sbin/nft', 'system.slice/bc250-llm-gate.service'))
        args, kwargs = run.call_args
        self.assertEqual(args[0], ['/usr/sbin/nft', '--check', '--file', '-'])
        self.assertIn('socket cgroupv2 level 2 "system.slice/bc250-llm-gate.service"', kwargs['input'])
        self.assertNotIn(' drop', kwargs['input'])
        self.assertNotIn(' reject', kwargs['input'])

    def test_unexpected_cgroup_and_failed_check_are_not_treated_as_success(self):
        with patch.object(module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)) as run:
            with self.assertRaises(ValueError):
                module.check_expression('/usr/sbin/nft', 'system.slice/other.service')
            run.assert_not_called()
            self.assertFalse(module.check_expression('/usr/sbin/nft', 'system.slice/bc250-llm-gate.service'))


if __name__ == '__main__':
    unittest.main()
