#!/usr/bin/env python3
"""Focused fail-closed tests; all trust and verifier responses are mocked."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/offline-attestation-check.py'
spec = importlib.util.spec_from_file_location('offline_check', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OfflineCheckTest(unittest.TestCase):
    def checker(self):
        pins = {key: ('a' * 64) for key in ('gh', 'verifier', 'artifact', 'bundle', 'trusted_root')}
        return module.OfflineAttestationCheck(
            gh='/fixture/gh', verifier='/fixture/verifier.py', artifact='/fixture/candidate',
            bundle='/fixture/bundle', trusted_root='/fixture/root', home='/fixture/home',
            commit='b' * 40, digest='a' * 64, run_id='42', attempt='1', pins=pins)

    def test_requires_matching_pin(self):
        with self.assertRaises(ValueError):
            module.OfflineAttestationCheck(gh='/a', verifier='/b', artifact='/c', bundle='/d',
                trusted_root='/e', home='/h', commit='b' * 40, digest='a' * 64,
                run_id='42', attempt='1', pins={})

    def test_rejects_wrong_inputs_and_hash_before_load(self):
        check = self.checker()
        with patch.object(module.os, 'geteuid', return_value=0):
            with self.assertRaises(ValueError):
                check('c' * 40, 'a' * 64)
            with patch.object(module, 'trusted_snapshot', return_value=((), 'f' * 64)), \
                    patch.object(module.importlib.util, 'spec_from_file_location') as load:
                with self.assertRaises(ValueError):
                    check('b' * 40, 'a' * 64)
                load.assert_not_called()

    def test_verifier_gets_sanitized_environment_and_results_rechecked(self):
        check = self.checker()
        calls = []
        def verify(*args, **kwargs):
            calls.append(kwargs)
            return 'a' * 64
        spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _: None))
        verifier = SimpleNamespace(verify=verify)
        with patch.object(module.os, 'geteuid', return_value=0), \
                patch.object(module.os, 'access', return_value=True), \
                patch.object(module, 'trusted_snapshot', return_value=((), 'a' * 64)), \
                patch.object(module.importlib.util, 'spec_from_file_location', return_value=spec), \
                patch.object(module.importlib.util, 'module_from_spec', return_value=verifier):
            self.assertTrue(check('b' * 40, 'a' * 64))
        self.assertEqual(calls[0]['env'], {'HOME': '/fixture/home', 'PATH': '/usr/bin:/bin', 'LANG': 'C'})
        self.assertEqual(str(calls[0]['bundle']), '/fixture/bundle')


if __name__ == '__main__':
    unittest.main()
