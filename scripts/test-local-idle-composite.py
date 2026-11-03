#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('idle', Path(__file__).resolve().parents[1] / 'deploy/model-control/local-idle-composite.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TestIdle(unittest.TestCase):
    def test_sequence_and_loss_of_fence(self):
        calls = []
        def check(name):
            def run():
                calls.append(name)
                return not (name == 'wiki' and calls.count('wiki') == 2)
            return run
        guard = module.LocalIdleComposite(check_wiki_fence=check('wiki'), check_other_callers_fenced=check('callers'),
                                          observe_llama=check('llama'), check_gpu_idle=check('gpu'))
        with self.assertRaises(ValueError):
            guard()
        self.assertEqual(calls, ['wiki', 'callers', 'llama', 'gpu', 'wiki'])

    def test_every_failure_blocks(self):
        for fail in range(4):
            checks = [lambda: True for _ in range(4)]
            checks[fail] = lambda: False
            guard = module.LocalIdleComposite(check_wiki_fence=checks[0], check_other_callers_fenced=checks[1],
                                              observe_llama=checks[2], check_gpu_idle=checks[3])
            with self.assertRaises(ValueError):
                guard()

    def test_success(self):
        guard = module.LocalIdleComposite(check_wiki_fence=lambda: True, check_other_callers_fenced=lambda: True,
                                          observe_llama=lambda: True, check_gpu_idle=lambda: True)
        self.assertIs(guard(), True)


if __name__ == '__main__':
    unittest.main()
