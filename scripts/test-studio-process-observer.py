#!/usr/bin/env python3
"""Observe only a disposable child process, not the Studio service."""
import importlib.util
import os
import subprocess
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/studio-process-observer.py'
spec = importlib.util.spec_from_file_location('studio_process_observer', path)
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class ProcessObserverTest(unittest.TestCase):
    def test_expected_process_and_mismatches(self):
        child = subprocess.Popen(['/usr/bin/sleep', '60'], cwd='/')
        try:
            identity = child.pid, observer.starttime(child.pid)
            params = dict(main_pid=lambda: child.pid, python='/usr/bin/sleep', cwd='/',
                          argv=(b'/usr/bin/sleep', b'60'), uid=os.getuid())
            self.assertTrue(observer.verify(identity, **params))
            with self.assertRaises(ValueError):
                observer.verify(identity, **{**params, 'argv': (b'/usr/bin/sleep', b'61')})
            with self.assertRaises(ValueError):
                observer.verify(identity, **{**params, 'uid': os.getuid() + 1})
            with self.assertRaises(ValueError):
                observer.verify(identity, **{**params, 'main_pid': lambda: child.pid + 1})
        finally:
            child.terminate()
            child.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
