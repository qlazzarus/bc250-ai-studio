#!/usr/bin/env python3
"""Check preparation record ordering without privileged filesystem changes."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/assemble-pinned-coordinator.py'
spec = importlib.util.spec_from_file_location('pinned_preparation', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreparationTest(unittest.TestCase):
    def exercise(self, fail):
        events = []
        class Journal:
            def __init__(self, _): events.append('open')
            def release(self, *_): events.append('release')
            def __call__(self, event): events.append(event)
            def close(self): events.append('close')
        def prepare(_, *, check_release):
            self.assertTrue(check_release())
            events.append('prepare')
            if fail:
                raise ValueError('injected failure')
        def load(name, _):
            return SimpleNamespace(prepare=prepare) if name == 'authenticated_initial_preparation' else SimpleNamespace(MigrationJournal=Journal)
        args = dict(root='/opt/test', archive='/tmp/test', bootstrap_checker='/tmp/check',
                    bootstrap_sha256='a' * 64, journal_dir='/tmp/record',
                    commit='b' * 40, artifact_sha256='c' * 64)
        with patch.object(module, 'authenticated_checker', return_value=lambda *_: True), patch.object(module, 'load', side_effect=load):
            if fail:
                with self.assertRaises(ValueError):
                    module.prepare_initial(**args)
            else:
                self.assertTrue(module.prepare_initial(**args))
        return events

    def test_success(self):
        self.assertEqual(self.exercise(False), ['open', 'release', 'initial_preparation:begin', 'prepare',
                                                'initial_preparation:confirmed', 'close'])

    def test_failure_has_no_confirmation(self):
        self.assertEqual(self.exercise(True), ['open', 'release', 'initial_preparation:begin', 'prepare', 'close'])


if __name__ == '__main__':
    unittest.main()
