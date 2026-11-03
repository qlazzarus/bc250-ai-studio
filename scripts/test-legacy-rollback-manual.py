#!/usr/bin/env python3
"""Exercise rollback ordering and fail-stop behavior without real services."""
import importlib.util
import unittest
from pathlib import Path

file = Path(__file__).resolve().parents[1] / 'deploy/model-control/legacy-rollback-manual.py'
spec = importlib.util.spec_from_file_location('manual_rollback', file)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Record:
    def __init__(self):
        self.events = []

    def __call__(self, event):
        self.events.append(event)

    def rollback_path(self, kind, path):
        self.events.append((kind, path))


class Wiki:
    def __init__(self):
        self.blocked = True

    def check(self):
        return self.blocked

    def release(self, *, can_release):
        if not can_release():
            raise ValueError('cannot release')
        self.blocked = False
        return True


class ManualRollbackTest(unittest.TestCase):
    def setUp(self):
        self.record = Record()
        self.wiki = Wiki()
        self.actions = []
        self.ready = False
        self.safe = True
        def action(name, result=None):
            def run(*args):
                self.actions.append(name)
                return result
            return run
        self.rollback = module.ManualRollback(
            record=self.record, wiki_fence=self.wiki, check_maintenance=lambda: True,
            inspect_new=lambda: True, stop_new=action('stop'), require_stopped=action('stopped'),
            preserve_new=action('preserve', '/evidence'), recovery_safe=lambda _: self.safe,
            verify_backup=action('verify_backup'), stage_backup=action('stage', '/stage'),
            restore_legacy=action('restore'), start_legacy_gate=action('gate'),
            restore_pause=action('pause'), start_legacy_studio=action('studio'),
            client_stopped=lambda: True, verify_legacy=lambda: self.ready,
            restore_ingress=action('ingress', True))

    def test_manual_boundary_and_order(self):
        self.rollback.begin()
        self.assertTrue(self.wiki.blocked)
        self.assertEqual(self.rollback.phase, 'await_client')
        self.assertNotIn('ingress', self.actions)
        self.assertEqual(self.actions, ['stop', 'stopped', 'preserve', 'verify_backup',
                                        'stage', 'restore', 'gate', 'pause', 'studio'])
        self.ready = True
        self.rollback.finish_after_client_restart()
        self.assertFalse(self.wiki.blocked)
        self.assertEqual(self.rollback.phase, 'complete')
        self.assertLess(self.record.events.index(('evidence', '/evidence')),
                        self.record.events.index('rollback_preserve:confirmed'))
        self.assertLess(self.record.events.index('rollback_wiki_release:confirmed'),
                        self.record.events.index('rollback_ingress_restore:begin'))

    def test_unsafe_evidence_fails_closed(self):
        self.safe = False
        with self.assertRaises(module.RollbackError):
            self.rollback.begin()
        self.assertTrue(self.wiki.blocked)
        self.assertIn(('evidence', '/evidence'), self.record.events)
        self.assertNotIn('restore', self.actions)

    def test_client_failure_preserves_fence(self):
        self.rollback.begin()
        with self.assertRaises(module.RollbackError):
            self.rollback.finish_after_client_restart()
        self.assertTrue(self.wiki.blocked)
        self.assertNotIn('rollback_wiki_release:begin', self.record.events)
        self.assertNotIn('ingress', self.actions)


if __name__ == '__main__':
    unittest.main()
