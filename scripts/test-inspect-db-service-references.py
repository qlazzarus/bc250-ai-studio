#!/usr/bin/env python3
"""Test service identity stability around the read-only reference observer."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).with_name('inspect-db-service-references.py')
spec = importlib.util.spec_from_file_location('db_service_inspection', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InspectionTest(unittest.TestCase):
    def test_same_service_processes_and_references(self):
        pids = [101, 102, 101, 102]
        with patch.object(module.os, 'geteuid', return_value=0), \
             patch.object(module, 'unit_pid', side_effect=pids):
            result = module.inspect(lambda ids, root, db: {ids[0]: frozenset({'fd'}), ids[1]: frozenset()})
        self.assertEqual(result, {'Studio': frozenset({'fd'}), 'gate': frozenset()})

    def test_service_change_rejected(self):
        with patch.object(module.os, 'geteuid', return_value=0), \
             patch.object(module, 'unit_pid', side_effect=[101, 102, 101, 103]):
            with self.assertRaises(ValueError):
                module.inspect(lambda ids, root, db: {pid: frozenset() for pid in ids})


if __name__ == '__main__':
    unittest.main()
