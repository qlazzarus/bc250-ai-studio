#!/usr/bin/env python3
"""Tests only the candidate SQLite reservation, not the complete DB fence."""
import importlib.util
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/sqlite-writer-guard.py'
spec = importlib.util.spec_from_file_location('sqlite_writer_guard', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / 'fixture.db'
        with sqlite3.connect(self.db) as connection:
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute('CREATE TABLE item(value TEXT)')

    def tearDown(self):
        self.tmp.cleanup()

    def test_existing_connection_rejected_until_release(self):
        writer = sqlite3.connect(self.db, timeout=0)
        guard = module.SQLiteWriterGuard(self.db)
        try:
            self.assertTrue(guard.acquire())
            self.assertFalse(guard.check())
            with self.assertRaises(sqlite3.OperationalError):
                writer.execute("INSERT INTO item VALUES ('busy')")
            writer.rollback()
            guard.release()
            self.assertFalse(guard.check())
            writer.execute("INSERT INTO item VALUES ('ok')")
            writer.commit()
        finally:
            if guard.connection is not None:
                guard.release()
            writer.close()

    def test_busy_writer_prevents_acquire(self):
        writer = sqlite3.connect(self.db, timeout=0)
        try:
            writer.execute('BEGIN IMMEDIATE')
            guard = module.SQLiteWriterGuard(self.db)
            with self.assertRaises(sqlite3.OperationalError):
                guard.acquire()
            self.assertFalse(guard.check())
        finally:
            writer.rollback()
            writer.close()

    def test_replaced_path_is_not_confirmed(self):
        guard = module.SQLiteWriterGuard(self.db)
        try:
            guard.acquire()
            self.db.rename(self.db.with_suffix('.old'))
            self.db.touch()
            self.assertFalse(guard.check())
        finally:
            guard.release()

    def test_shm_descriptor_close_can_release_reservation(self):
        guard = module.SQLiteWriterGuard(self.db)
        probe = ('import sqlite3,sys\n'
                 'c=sqlite3.connect(sys.argv[1],timeout=0)\n'
                 'try: c.execute("BEGIN IMMEDIATE")\n'
                 'except sqlite3.OperationalError: print("busy")\n'
                 'else: print("acquired")\n')
        def observe():
            return subprocess.check_output([sys.executable, '-c', probe, str(self.db)], text=True).strip()
        try:
            guard.acquire()
            self.assertEqual(observe(), 'busy')
            descriptor = os.open(str(self.db) + '-shm', os.O_RDONLY)
            os.close(descriptor)
            self.assertEqual(observe(), 'acquired')
            self.assertTrue(guard.connection.in_transaction)
            self.assertFalse(guard.check())
        finally:
            guard.release()


if __name__ == '__main__':
    unittest.main()
