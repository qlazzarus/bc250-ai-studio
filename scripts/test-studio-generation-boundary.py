#!/usr/bin/env python3
"""Test fail-closed lifecycle ordering; production validators are not simulated."""
import importlib.util
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/studio-generation-boundary.py'
spec = importlib.util.spec_from_file_location('studio_generation_boundary', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Watch:
    done = False

    def exited(self):
        return self.done


class BoundaryTest(unittest.TestCase):
    def test_stop_then_replacement_and_lost_identity(self):
        watch = Watch()
        identity = [(123, '45')]
        boundary = module.StudioGenerationBoundary(watch, check_stopped=lambda: True,
            observe_replacement=lambda: identity[0], verify_replacement=lambda value: value == identity[0])
        with self.assertRaises(module.GenerationError):
            boundary.bind_replacement()
        watch.done = True
        self.assertTrue(boundary.mark_stopped())
        self.assertTrue(boundary.bind_replacement())
        self.assertTrue(boundary.check())
        identity[0] = (124, '46')
        with self.assertRaises(module.GenerationError):
            boundary.check()
        identity[0] = (123, '45')
        with self.assertRaises(module.GenerationError):
            boundary.check()

    def test_failed_stop_cannot_be_retried(self):
        watch = Watch()
        boundary = module.StudioGenerationBoundary(watch, check_stopped=lambda: True,
            observe_replacement=lambda: (123, '45'), verify_replacement=lambda _: True)
        with self.assertRaises(module.GenerationError):
            boundary.mark_stopped()
        watch.done = True
        with self.assertRaises(module.GenerationError):
            boundary.mark_stopped()


if __name__ == '__main__':
    unittest.main()
