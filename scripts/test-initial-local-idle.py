#!/usr/bin/env python3
"""Check fail-closed initial idle composition with isolated callbacks."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/initial-local-idle.py'
spec = importlib.util.spec_from_file_location('initial_idle', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InitialIdleTest(unittest.TestCase):
    def fixture(self):
        calls = []
        good = {'wiki': True, 'callers': True, 'gpu': True}
        def check(name):
            def run():
                calls.append(name)
                return good[name]
            return run
        def observe(guard, *, llama_key):
            calls.append('llama')
            self.assertEqual(llama_key, 'fixture-key')
            return True
        def listener_identity():
            calls.append('listener')
            return ('pid', 'start', 'namespace', 'socket')
        with patch.object(module.os, 'geteuid', return_value=0), \
             patch.object(module, 'trusted'), \
             patch.object(module.importlib.util, 'spec_from_file_location') as fake_spec, \
             patch.object(module.importlib.util, 'module_from_spec',
                          return_value=SimpleNamespace(observe=observe, listener_identity=listener_identity)):
            fake_spec.return_value.loader.exec_module.return_value = None
            runner = module.InitialLocalIdle('/fixture', check_wiki=check('wiki'),
                check_other_callers=check('callers'), check_gpu=check('gpu'),
                llama_key=lambda: 'fixture-key')
        return runner, calls, good

    def test_success_order(self):
        runner, calls, _ = self.fixture()
        with patch.object(module, 'trusted'):
            self.assertTrue(runner())
        self.assertEqual(calls, ['wiki', 'callers', 'listener', 'llama', 'listener', 'gpu', 'wiki', 'callers'])

    def test_direct_caller_and_gpu_fail_closed(self):
        for name in ('wiki', 'callers', 'gpu'):
            runner, _, good = self.fixture()
            good[name] = False
            with patch.object(module, 'trusted'), self.assertRaises(ValueError):
                runner()

    def test_observer_failure_propagates(self):
        runner, _, _ = self.fixture()
        runner.observer.observe = lambda *_args, **_kwargs: False
        with patch.object(module, 'trusted'), self.assertRaises(ValueError):
            runner()

    def test_listener_change_blocks_before_gpu_check(self):
        runner, calls, _ = self.fixture()
        tokens = iter(('old', 'new'))
        runner.listener.listener_identity = lambda: next(tokens)
        with patch.object(module, 'trusted'), self.assertRaises(ValueError):
            runner()
        self.assertNotIn('gpu', calls)


if __name__ == '__main__':
    unittest.main()
