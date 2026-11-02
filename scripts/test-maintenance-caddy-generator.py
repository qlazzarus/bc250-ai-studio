#!/usr/bin/env python3
"""Check that generation is limited to the reviewed Caddy routing."""

import importlib.util
import unittest
from pathlib import Path

source = Path(__file__).resolve().parents[1] / 'deploy/model-control/create-maintenance-caddy.py'
spec = importlib.util.spec_from_file_location('maintenance_caddy', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GeneratorTest(unittest.TestCase):
    def setUp(self):
        self.original = '\n'.join(module.EXPECTED) + '\n'

    def test_both_api_handlers_are_replaced_and_wiki_is_preserved(self):
        result = module.candidate(self.original)
        self.assertEqual(result.count('respond "Service temporarily unavailable" 503'), 2)
        self.assertIn('handle_path /wiki/* {\nreverse_proxy 127.0.0.1:8020\n}', result)
        self.assertNotIn('reverse_proxy 127.0.0.1:8010', result)
        self.assertNotIn('reverse_proxy 127.0.0.1:8090', result)

    def test_unknown_directive_or_import_is_rejected(self):
        for changed in (self.original.replace(':80 {', ':80 {\nimport /etc/caddy/extra'),
                        self.original.replace('127.0.0.1:8020', '127.0.0.1:8021')):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                module.candidate(changed)

    def test_comments_and_indentation_are_preserved(self):
        original = '# example\n' + self.original.replace('handle /wiki {', '    handle /wiki {')
        result = module.candidate(original)
        self.assertTrue(result.startswith('# example\n'))
        self.assertIn('    handle /wiki {', result)


if __name__ == '__main__':
    unittest.main()
