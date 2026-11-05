#!/usr/bin/env python3
"""Exercise pidfd tracking with a disposable child, never a real service."""
import importlib.util
import subprocess
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/old-studio-process-watch.py'
spec = importlib.util.spec_from_file_location('old_studio_watch', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OldStudioWatchTest(unittest.TestCase):
    def test_tracks_old_process_across_new_process_start(self):
        old = subprocess.Popen(['/usr/bin/sleep', '60'])
        new = None
        watch = None
        try:
            started = module.process_starttime(old.pid)
            with self.assertRaises(ValueError):
                module.OldStudioProcessWatch(old.pid, str(int(started) + 1))
            watch = module.OldStudioProcessWatch(old.pid, started)
            self.assertFalse(watch.exited())
            old.terminate()
            old.wait(timeout=5)
            new = subprocess.Popen(['/usr/bin/sleep', '60'])
            self.assertTrue(watch.exited())
            watch.close()
            with self.assertRaises(ValueError):
                watch.exited()
        finally:
            if watch is not None:
                watch.close()
            for child in (old, new):
                if child is not None and child.poll() is None:
                    child.terminate()
                    child.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
