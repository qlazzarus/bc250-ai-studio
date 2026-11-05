#!/usr/bin/env python3
import importlib.util
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/sqlite-process-guard.py'
spec = importlib.util.spec_from_file_location('sqlite_process_guard', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProcessGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / 'data.sqlite3'
        c = sqlite3.connect(self.db)
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('CREATE TABLE jobs(id INTEGER)')
        c.commit()
        c.close()
        self.guard = module.SQLiteProcessGuard(self.db)

    def tearDown(self):
        self.guard.release()
        self.tmp.cleanup()

    def test_parent_shm_close_and_child_death(self):
        self.assertTrue(self.guard.acquire())
        fd = os.open(str(self.db) + '-shm', os.O_RDONLY)
        os.close(fd)
        self.assertTrue(self.guard.check())
        c = sqlite3.connect(self.db, timeout=0)
        try:
            with self.assertRaises(sqlite3.OperationalError):
                c.execute('BEGIN IMMEDIATE')
            self.guard.process.kill()
            self.guard.process.wait(timeout=5)
            self.assertFalse(self.guard.check())
            c.execute('BEGIN IMMEDIATE')
            c.rollback()
        finally:
            c.close()

    def test_existing_writer_rejects_acquisition(self):
        c = sqlite3.connect(self.db, timeout=0, isolation_level=None)
        try:
            c.execute('BEGIN IMMEDIATE')
            with self.assertRaises(RuntimeError):
                self.guard.acquire()
            self.assertFalse(self.guard.check())
        finally:
            c.rollback()
            c.close()

    def test_path_replacement_rejects_check(self):
        self.guard.acquire()
        self.db.rename(self.db.with_suffix('.old'))
        self.db.touch()
        self.assertFalse(self.guard.check())


if __name__ == '__main__':
    unittest.main()
