#!/usr/bin/env python3
"""Exercise fail-stop handoff ordering with isolated mock callbacks."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('handoff',
    Path(__file__).resolve().parents[1] / 'deploy/model-control/gpu-lock-handoff.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeFence:
    def __init__(self):
        self.held = False

    def acquire(self):
        self.held = True
        return True

    def check(self):
        return self.held

    def release(self):
        self.held = False


class HandoffTest(unittest.TestCase):
    def make(self):
        fence = FakeFence()
        state = {'old': False, 'callers': True, 'gpu': True, 'prepared': False}
        def prepare():
            state['prepared'] = True
            return True
        runner = module.GPULockHandoff(fence=fence, old_generation_gone=lambda: state['old'],
            other_callers_blocked=lambda: state['callers'], gpu_safe=lambda: state['gpu'],
            prepare_new_lock=prepare)
        return runner, fence, state

    def test_running_legacy_does_not_prepare(self):
        runner, fence, state = self.make()
        with self.assertRaises(module.HandoffError):
            runner.acquire()
        self.assertFalse(state['prepared'])
        self.assertFalse(fence.held)

    def test_lost_condition_does_not_release(self):
        runner, fence, state = self.make()
        state['old'] = True
        self.assertTrue(runner.acquire())
        state['callers'] = False
        with self.assertRaises(module.HandoffError):
            runner.check()
        self.assertTrue(fence.held)
        with self.assertRaises(module.HandoffError):
            runner.release(can_release=lambda: True)

    def test_release_requires_confirmation(self):
        runner, fence, state = self.make()
        state['old'] = True
        self.assertTrue(runner.acquire())
        self.assertTrue(runner.release(can_release=lambda: True))
        self.assertFalse(fence.held)
        self.assertEqual(runner.phase, 'released')


if __name__ == '__main__':
    unittest.main()
