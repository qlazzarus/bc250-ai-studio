#!/usr/bin/env python3
"""Exercise candidate flock lifetime using disposable local files."""
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/advisory-gpu-fence.py'
spec = importlib.util.spec_from_file_location('gpu_fence', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FenceTest(unittest.TestCase):
    def test_busy_replacement_and_release(self):
        with tempfile.TemporaryDirectory() as root, patch.object(module.os, 'geteuid', return_value=0):
            lock = Path(root) / 'gpu.lock'
            lock.touch(mode=0o600)
            fence = module.AdvisoryGPUFence(lock, group_id=os.getgid())
            fence.check_parents = lambda: None
            fence.check_file = lambda _: None
            probe = ('import fcntl,os,sys\nfd=os.open(sys.argv[1],os.O_RDWR)\n'
                     'try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)\n'
                     'except BlockingIOError: raise SystemExit(42)\n')
            def attempt(target):
                return subprocess.run([sys.executable, '-c', probe, str(target)], check=False).returncode
            try:
                self.assertTrue(fence.acquire())
                self.assertEqual(attempt(lock), 42)
                old = Path(root) / 'old.lock'
                lock.rename(old)
                lock.touch(mode=0o600)
                with self.assertRaises(ValueError):
                    fence.check()
                self.assertEqual(attempt(old), 42)
                fence.release()
                self.assertEqual(attempt(old), 0)
            finally:
                if fence.fd is not None:
                    fence.release()


if __name__ == '__main__':
    unittest.main()
