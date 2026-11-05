#!/usr/bin/env python3
"""Verify fail-closed connection of the generation and startup candidates."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/assemble-coordinator.py'
spec = importlib.util.spec_from_file_location('generation_bound_assembler', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GenerationBoundTest(unittest.TestCase):
    def fixture(self):
        calls = []
        safe = [True]
        generation = SimpleNamespace(
            mark_stopped=lambda: calls.append('stopped') or True,
            bind_replacement=lambda: calls.append('bind') or True,
            check=lambda: calls.append('check') or safe[0])
        startup = SimpleNamespace(start=lambda: calls.append('start'), finish=lambda: calls.append('finish'))
        runner = module.GenerationBoundStartup(generation, lambda _: calls.append('install') or True, startup)
        return runner, calls, safe

    def test_order_and_repeat_rejection(self):
        runner, calls, _ = self.fixture()
        with self.assertRaises(ValueError):
            runner.start()
        self.assertTrue(runner.install('/fixture'))
        runner.start()
        runner.finish()
        self.assertEqual(calls, ['stopped', 'install', 'start', 'bind', 'check', 'finish', 'check'])
        with self.assertRaises(ValueError):
            runner.finish()

    def test_lost_generation_blocks_confirmation(self):
        runner, calls, safe = self.fixture()
        runner.install('/fixture')
        runner.start()
        safe[0] = False
        with self.assertRaises(ValueError):
            runner.finish()
        self.assertNotIn('finish', calls)
        safe[0] = True
        with self.assertRaises(ValueError):
            runner.finish()

    def test_failed_stop_blocks_install(self):
        runner, calls, _ = self.fixture()
        runner.generation.mark_stopped = lambda: False
        with self.assertRaises(ValueError):
            runner.install('/fixture')
        self.assertNotIn('install', calls)
        with self.assertRaises(ValueError):
            runner.install('/fixture')


if __name__ == '__main__':
    unittest.main()
