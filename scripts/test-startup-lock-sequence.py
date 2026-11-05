#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('startup_lock',
    Path(__file__).resolve().parents[1] / 'deploy/model-control/startup-lock-sequence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Handoff:
    def __init__(self):
        self.held = False

    def acquire(self):
        self.held = True
        return True

    def check(self):
        return self.held

    def release(self, *, can_release):
        if not can_release():
            raise ValueError('blocked')
        self.held = False
        return True


class StartupTest(unittest.TestCase):
    def fixture(self, confirm, deployment=None):
        events = []
        handoff = Handoff()
        deployment = deployment if deployment is not None else {'held': True}
        runner = module.StartupLockSequence(record=events.append, check_pre_handoff=lambda: True,
            prepare_tmpfiles=lambda: True, handoff=handoff, check_before_confirm=lambda: True,
            check_deployment_hold=lambda: deployment['held'], confirm_startup=lambda: confirm(handoff))
        return runner, handoff, events

    def test_confirmation_runs_after_lock_is_released(self):
        runner, handoff, events = self.fixture(lambda lock: not lock.held)
        self.assertTrue(runner.begin())
        self.assertTrue(runner.confirm_after_client_restart())
        self.assertEqual(events[-3:], ['startup_lock_transfer:begin',
                                      'startup_lock_transfer:released',
                                      'startup_lock_transfer:confirmed'])
        self.assertFalse(handoff.held)

    def test_unconfirmed_transfer_is_not_marked_complete(self):
        runner, handoff, events = self.fixture(lambda _: False)
        runner.begin()
        with self.assertRaises(module.StartupLockError):
            runner.confirm_after_client_restart()
        self.assertFalse(handoff.held)
        self.assertEqual(events[-1], 'startup_lock_transfer:released')
        self.assertEqual(runner.phase, 'failed')


    def test_confirmation_response_lost_is_not_retried(self):
        gate = {'startup': True, 'attempts': 0}
        def confirm(_lock):
            gate['attempts'] += 1
            gate['startup'] = False  # Simulate remote application followed by response loss.
            raise TimeoutError('response lost')
        runner, handoff, events = self.fixture(confirm)
        runner.begin()
        with self.assertRaises(module.StartupLockError):
            runner.confirm_after_client_restart()
        self.assertFalse(handoff.held)
        self.assertFalse(gate['startup'])
        self.assertEqual(events[-1], 'startup_lock_transfer:released')
        with self.assertRaises(module.StartupLockError):
            runner.confirm_after_client_restart()
        self.assertEqual(gate['attempts'], 1)

    def test_missing_deployment_hold_keeps_lock_and_skips_confirmation(self):
        hold = {'held': True}
        attempts = []
        runner, handoff, events = self.fixture(lambda _: attempts.append(True) or True, hold)
        runner.begin()
        hold['held'] = False
        with self.assertRaises(module.StartupLockError):
            runner.confirm_after_client_restart()
        self.assertTrue(handoff.held)
        self.assertEqual(attempts, [])
        self.assertEqual(events[-1], 'startup_lock:confirmed')

    def test_hold_loss_during_acquire_preserves_lock_without_confirmation(self):
        hold = {'held': True}
        runner, handoff, events = self.fixture(lambda _: True, hold)
        acquire = handoff.acquire
        def lose_hold():
            result = acquire()
            hold['held'] = False
            return result
        handoff.acquire = lose_hold
        with self.assertRaises(module.StartupLockError):
            runner.begin()
        self.assertTrue(handoff.held)
        self.assertEqual(events[-1], 'startup_lock:begin')

    def test_hold_loss_after_release_stops_before_confirmation(self):
        hold = {'held': True}
        attempts = []
        runner, handoff, events = self.fixture(lambda _: attempts.append(True) or True, hold)
        release = handoff.release
        def lose_hold(*, can_release):
            result = release(can_release=can_release)
            hold['held'] = False
            return result
        handoff.release = lose_hold
        runner.begin()
        with self.assertRaises(module.StartupLockError):
            runner.confirm_after_client_restart()
        self.assertFalse(handoff.held)
        self.assertEqual(attempts, [])
        self.assertEqual(events[-1], 'startup_lock_transfer:released')


if __name__ == '__main__':
    unittest.main()
