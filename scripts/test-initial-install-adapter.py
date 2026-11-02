#!/usr/bin/env python3
"""Focused fail-stop tests; all privileged operations are mocked."""
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/initial-install-adapter.py'
spec = importlib.util.spec_from_file_location('initial_install', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InitialInstallTest(unittest.TestCase):
    def fixture(self, *, maintenance=True, studio_failure=False):
        events = []
        adapter = module.InitialInstallAdapter.__new__(module.InitialInstallAdapter)
        adapter.release = Path('/opt/fixture')
        adapter.displaced = Path('/opt/displaced')
        adapter.cache = Path('/var/cache/fixture')
        adapter.manifest_dir = Path('/var/backups/manifest')
        adapter.source = adapter.release / 'deploy/model-control'
        adapter.offline = True
        adapter.check_release = lambda: True
        adapter.check_configuration = lambda: True
        adapter.check_maintenance = lambda: maintenance
        adapter.check_local_idle = lambda: True
        adapter.migration = SimpleNamespace(create_state=lambda *_: events.append('gate'))
        def studio(*args, **kwargs):
            events.append('studio')
            self.assertTrue(kwargs['check_ready']())
            if studio_failure:
                raise ValueError('fixture failure')
        adapter.studio = SimpleNamespace(install=studio)
        adapter.units = SimpleNamespace(install=lambda *_: events.append('units'))
        adapter.compare = SimpleNamespace(_same=lambda *_: None)
        return adapter, events

    def test_order_and_rechecks(self):
        adapter, events = self.fixture()
        with tempfile.TemporaryDirectory() as root, patch.object(module, 'trusted'), \
             patch.object(module, 'GATE_DIR', Path(root) / 'gate'), \
             patch.object(module.subprocess, 'run') as commands:
            self.assertTrue(adapter('/var/backups/bc250-model-migration.Abc12345'))
        self.assertEqual(events, ['gate', 'studio', 'units'])
        self.assertGreaterEqual(commands.call_count, 7)

    def test_maintenance_failure_prevents_mutation(self):
        adapter, events = self.fixture(maintenance=False)
        with patch.object(module, 'trusted'), patch.object(module.subprocess, 'run') as commands:
            with self.assertRaises(ValueError):
                adapter('/var/backups/bc250-model-migration.Abc12345')
        self.assertEqual(events, [])
        commands.assert_not_called()

    def test_studio_failure_does_not_install_units(self):
        adapter, events = self.fixture(studio_failure=True)
        with tempfile.TemporaryDirectory() as root, patch.object(module, 'trusted'), \
             patch.object(module, 'GATE_DIR', Path(root) / 'gate'), \
             patch.object(module.subprocess, 'run'):
            with self.assertRaises(ValueError):
                adapter('/var/backups/bc250-model-migration.Abc12345')
        self.assertEqual(events, ['gate', 'studio'])

    def test_backup_verification_failure_prevents_mutation(self):
        adapter, events = self.fixture()
        def command(args, **kwargs):
            if args[0] == '/usr/bin/python3':
                raise subprocess.CalledProcessError(1, args)
        with patch.object(module, 'trusted'), patch.object(module.subprocess, 'run', side_effect=command):
            with self.assertRaises(subprocess.CalledProcessError):
                adapter('/var/backups/bc250-model-migration.Abc12345')
        self.assertEqual(events, [])


if __name__ == '__main__':
    unittest.main()
