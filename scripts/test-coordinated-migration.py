#!/usr/bin/env python3
"""Focused ordering and fail-stop tests; all external effects are mocked."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/coordinated-migration.py'
spec = importlib.util.spec_from_file_location('migration', path)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class CoordinatorTest(unittest.TestCase):
    def fixture(self, fail=None):
        events = []
        def action(name, value=None):
            def run(*args, **kwargs):
                events.append(name)
                if name == fail:
                    raise RuntimeError('fixture failure')
                return value
            return run
        def transition(*, mode, **kwargs):
            return action('transition_' + mode)()
        class Record:
            def __call__(self, event):
                return action('record')(event)
            def backup(self, path):
                return action('record_backup')(path)
        record = Record()
        runner = migration.CoordinatedMigration(
            record=record, preflight=action('preflight', True),
            transition=transition, transition_args={},
            backup_adapter=SimpleNamespace(run=action('backup', '/fixture/backup')),
            install=action('install', True),
            startup=SimpleNamespace(start=action('start'), finish=action('finish')),
            verify_new=action('verify_new', True), verify_restored=action('verify_restored', True))
        return runner, events

    def test_operator_boundary_and_order(self):
        runner, events = self.fixture()
        runner.prepare_and_start()
        self.assertEqual(runner.phase, 'await_client')
        self.assertNotIn('finish', events)
        self.assertNotIn('transition_restore', events)
        runner.finish_after_client_restart()
        self.assertEqual(runner.phase, 'complete')
        self.assertLess(events.index('transition_enter'), events.index('backup'))
        self.assertLess(events.index('backup'), events.index('install'))
        self.assertLess(events.index('finish'), events.index('transition_restore'))
        self.assertLess(events.index('verify_new'), events.index('transition_restore'))

    def test_uncertain_maintenance_does_not_backup(self):
        runner, events = self.fixture('transition_enter')
        with self.assertRaises(migration.MigrationError):
            runner.prepare_and_start()
        self.assertEqual(runner.phase, 'failed')
        self.assertNotIn('backup', events)
        with self.assertRaises(migration.MigrationError):
            runner.prepare_and_start()

    def test_failed_new_confirmation_preserves_maintenance(self):
        runner, events = self.fixture('finish')
        runner.prepare_and_start()
        with self.assertRaises(migration.MigrationError):
            runner.finish_after_client_restart()
        self.assertNotIn('transition_restore', events)
        self.assertEqual(runner.phase, 'failed')

    def test_missing_backup_never_installs(self):
        runner, events = self.fixture()
        runner.backup.run = lambda: None
        with self.assertRaises(migration.MigrationError):
            runner.prepare_and_start()
        self.assertNotIn('install', events)

    def test_backup_record_failure_never_installs(self):
        runner, events = self.fixture('record_backup')
        with self.assertRaises(migration.MigrationError):
            runner.prepare_and_start()
        self.assertNotIn('install', events)

    def test_install_observes_backup_path_and_install_begin(self):
        runner, _ = self.fixture()
        entries = []
        class Record:
            def __call__(self, event):
                entries.append(event)
            def backup(self, path):
                entries.append(('legacy_backup:path', path))
        runner.record = Record()
        def install(path):
            self.assertEqual(entries[-3:], [('legacy_backup:path', path),
                                            'legacy_backup:confirmed', 'install:begin'])
            return True
        runner.install = install
        runner.prepare_and_start()
        self.assertEqual(runner.phase, 'await_client')

    def test_wiki_fence_wraps_backup_install_and_client_boundary(self):
        runner, events = self.fixture()
        class Wiki:
            def acquire(self):
                events.append('wiki_acquire')
                return True
            def check(self):
                events.append('wiki_check')
                return True
            def release(self, *, can_release):
                self.assert_release = can_release()
                events.append('wiki_release')
                return self.assert_release
        runner.wiki_fence = Wiki()
        runner.prepare_and_start()
        self.assertLess(events.index('transition_enter'), events.index('wiki_acquire'))
        self.assertLess(events.index('wiki_acquire'), events.index('backup'))
        self.assertNotIn('wiki_release', events)
        runner.finish_after_client_restart()
        self.assertLess(events.index('finish'), events.index('wiki_release'))
        self.assertLess(events.index('wiki_release'), events.index('transition_restore'))
        self.assertGreaterEqual(events.count('wiki_check'), 7)

    def test_failed_install_never_releases_wiki(self):
        runner, events = self.fixture('install')
        class Wiki:
            def acquire(self):
                events.append('wiki_acquire')
                return True
            def check(self): return True
            def release(self, **_):
                events.append('wiki_release')
                return True
        runner.wiki_fence = Wiki()
        with self.assertRaises(migration.MigrationError):
            runner.prepare_and_start()
        self.assertNotIn('wiki_release', events)
        self.assertNotIn('transition_restore', events)


if __name__ == '__main__':
    unittest.main()
