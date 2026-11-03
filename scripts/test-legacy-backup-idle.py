#!/usr/bin/env python3
"""Detect loss of local exclusion during backup; never touch services."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/legacy-backup-adapter.py'
spec = importlib.util.spec_from_file_location('legacy_backup_idle', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupIdleTest(unittest.TestCase):
    def adapter(self, checks):
        adapter = module.LegacyBackupAdapter.__new__(module.LegacyBackupAdapter)
        adapter.check_local_idle = lambda: next(checks)
        adapter.source = Path('/fixture')
        adapter.snapshot = Path('/fixture')
        adapter.require_stopped = lambda: None
        adapter.llama_connections = SimpleNamespace(check_host_llama=lambda: True)
        return adapter

    def test_database_check_fence_loss(self):
        adapter = self.adapter(iter([True, False]))
        adapter.studio_db = SimpleNamespace(inspect=lambda *args, **kwargs: None)
        with self.assertRaisesRegex(RuntimeError, 'DB 검사 후'):
            adapter.require_stopped_with_clear_database()

    def test_preserve_backup_when_fence_lost_during_creation(self):
        adapter = self.adapter(iter([True, False]))
        result = SimpleNamespace(stdout='백업 경로: /var/backups/bc250-model-migration.a1b2c3d4\n',
                                 stderr='', returncode=0)
        with patch.object(module.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(RuntimeError, '백업을 보존'):
                adapter.create_backup()

    def test_verification_rejects_fence_loss(self):
        adapter = self.adapter(iter([False]))
        with patch.object(module.subprocess, 'run'):
            with self.assertRaisesRegex(RuntimeError, '백업을 보존'):
                adapter.verify_backup(Path('/fixture/backup'))

    def test_open_llama_connection_rejects_before_database_or_backup(self):
        adapter = self.adapter(iter([True]))
        adapter.llama_connections = SimpleNamespace(check_host_llama=lambda: False)
        adapter.studio_db = SimpleNamespace(inspect=lambda *args, **kwargs: self.fail('database inspected'))
        with self.assertRaisesRegex(RuntimeError, 'llama 연결 종료'):
            adapter.require_stopped_with_clear_database()


if __name__ == '__main__':
    unittest.main()
