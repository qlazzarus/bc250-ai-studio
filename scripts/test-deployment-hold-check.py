#!/usr/bin/env python3
"""Exercise hold-check ordering with simulated status, record and ownership."""
import importlib.util
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/deployment-hold-check.py'
spec = importlib.util.spec_from_file_location('deployment_hold_check', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HoldCheckTest(unittest.TestCase):
    def test_generation_change_between_reads_is_rejected(self):
        states = iter([{'deployment_generation': 'a' * 32}, {'deployment_generation': 'b' * 32}])
        check = module.DeploymentHoldCheck(generation='a' * 32, fetch_status=lambda: next(states),
            matches_record=lambda _: True, check_ownership=lambda _: True)
        self.assertFalse(check())

    def test_owner_and_record_are_required(self):
        state = {'deployment_generation': 'a' * 32}
        for owner, record, result in ((True, True, True), (False, True, False), (True, False, False)):
            with self.subTest(owner=owner, record=record):
                check = module.DeploymentHoldCheck(generation='a' * 32, fetch_status=lambda: state,
                    matches_record=lambda _: record, check_ownership=lambda _: owner)
                self.assertIs(check(), result)
        with self.assertRaises(ValueError):
            module.DeploymentHoldCheck(generation='bad', fetch_status=lambda: state,
                matches_record=lambda _: True, check_ownership=lambda _: True)

    def test_fetch_error_is_not_accepted(self):
        def fail():
            raise OSError('fixture unavailable')
        check = module.DeploymentHoldCheck(generation='a' * 32, fetch_status=fail,
            matches_record=lambda _: True, check_ownership=lambda _: True)
        with self.assertRaises(OSError):
            check()


if __name__ == '__main__':
    unittest.main()
