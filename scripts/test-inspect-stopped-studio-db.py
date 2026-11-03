#!/usr/bin/env python3
"""Verify Studio database inspection against isolated SQLite fixtures."""
import importlib.util
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/inspect-stopped-studio-db.py'
spec = importlib.util.spec_from_file_location('studio_db_inspect', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StoppedDatabaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / 'studio.sqlite3'
        self.connection = sqlite3.connect(self.db)
        self.addCleanup(self.connection.close)
        self.connection.execute('PRAGMA journal_mode=WAL')
        self.connection.execute('CREATE TABLE jobs (status TEXT)')
        self.connection.execute('CREATE TABLE system_state (key TEXT, value TEXT)')
        self.connection.execute("INSERT INTO jobs VALUES ('completed')")
        self.connection.execute("INSERT INTO system_state VALUES ('transition', '{}')")
        self.connection.commit()
        for name, value in (('geteuid', lambda: 0),):
            p = patch.object(module.os, name, side_effect=value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(module, 'trusted_parents')
        p.start()
        self.addCleanup(p.stop)
        p = patch.object(module.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.getuid()))
        p.start()
        self.addCleanup(p.stop)

    def test_clean_and_unfinished_wal(self):
        self.assertTrue(module.inspect(self.db, check_stopped=lambda: True))
        self.connection.execute("INSERT INTO jobs VALUES ('queued')")
        self.connection.commit()
        with self.assertRaisesRegex(ValueError, '완료되지 않은'):
            module.inspect(self.db, check_stopped=lambda: True)

    def test_recovery_and_service_restart(self):
        self.connection.execute("INSERT INTO system_state VALUES ('recovery', '{\"blocked\":true}')")
        self.connection.commit()
        with self.assertRaisesRegex(ValueError, '복구'):
            module.inspect(self.db, check_stopped=lambda: True)
        with self.assertRaisesRegex(ValueError, '정지'):
            module.inspect(self.db, check_stopped=lambda: False)


if __name__ == '__main__':
    unittest.main()
