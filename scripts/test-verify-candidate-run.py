#!/usr/bin/env python3
import importlib.util
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('candidate_run', Path(__file__).with_name('verify-candidate-run.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RunIdentityTest(unittest.TestCase):
    def test_exact_run_and_attempt(self):
        raw = json.dumps([{'verificationResult': {'signature': {'certificate': {
            'runInvocationURI': 'https://github.com/qlazzarus/bc250-ai-studio/actions/runs/42/attempts/1'
        }}}}])
        module.require_run_uri(raw, '42', '1')
        for run, attempt in [('43', '1'), ('42', '2')]:
            with self.assertRaises(ValueError):
                module.require_run_uri(raw, run, attempt)

    def test_verifier_failure_does_not_accept_run_uri(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'candidate.tar.gz'
            artifact.write_bytes(b'fixture')
            with patch.object(module.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'gh')):
                with self.assertRaises(subprocess.CalledProcessError):
                    module.verify('/bin/true', artifact, 'a' * 40, '42', '1')

    def test_offline_bundle_and_root_must_be_paired(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'candidate.tar.gz'
            artifact.write_bytes(b'fixture')
            with self.assertRaises(ValueError):
                module.verify('/bin/true', artifact, 'a' * 40, '42', '1', bundle='/tmp/bundle')

    def test_rejects_missing_empty_duplicate_and_predicate_only(self):
        for raw in ('[]', '[{}]', '[{"verificationResult":{},"verificationResult":{}}]',
                    '[{"verificationResult":{"statement":{"predicate":{"runInvocationURI":"x"}}}}]'):
            with self.assertRaises(ValueError):
                module.require_run_uri(raw, '42', '1')


if __name__ == '__main__':
    unittest.main()
