#!/usr/bin/env python3
"""Exercise systemd D-Bus condition validation with the observed schema."""
import copy
import importlib.util
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/verify-wiki-condition.py'
spec = importlib.util.spec_from_file_location('verify_wiki_condition', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConditionTest(unittest.TestCase):
    def test_expected_and_unsafe_conditions(self):
        marker = '/run/fixture/blocked'
        good = {'type': 'a(sbbsi)', 'data': [['ConditionPathExists', False, True, marker, 0]]}
        self.assertTrue(module.require_block_condition(good, marker))
        bad = []
        for field, replacement in ((0, 'ConditionPathIsDirectory'), (1, True), (2, False),
                                   (3, '/other'), (4, False)):
            value = copy.deepcopy(good)
            value['data'][0][field] = replacement
            bad.append(value)
        value = copy.deepcopy(good)
        value['data'].append(value['data'][0][:])
        bad.extend([value, {'type': 's', 'data': []}, {'type': 'a(sbbsi)', 'data': 'bad'}])
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.require_block_condition(value, marker)


if __name__ == '__main__':
    unittest.main()
