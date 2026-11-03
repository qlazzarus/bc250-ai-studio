#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'inspect_deployment_record', Path(__file__).resolve().parents[1]
    / 'deploy/model-control/inspect-deployment-record.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RecordTest(unittest.TestCase):
    def test_duplicate_json_key_is_rejected(self):
        with self.assertRaises(ValueError):
            module.parse_rows(b'{"event":"other","event":"deployment_hold:confirmed"}\n')

    def test_unconfirmed_release_is_distinguished_from_confirmed(self):
        events = ['deployment_hold:begin', 'deployment_hold:confirmed',
                  'deployment_confirmation:begin']
        rows = [{'event': event} for event in events]
        self.assertIn('미완료', module.classify(rows))
        rows.append({'event': 'deployment_confirmation:confirmed'})
        self.assertIn('확인 기록 있음', module.classify(rows))

    def test_duplicate_or_out_of_order_events_are_rejected(self):
        for events in (['deployment_hold:confirmed'],
                       ['deployment_hold:begin', 'deployment_hold:begin'],
                       ['deployment_confirmation:confirmed']):
            with self.subTest(events=events), self.assertRaises(ValueError):
                module.classify([{'event': event} for event in events])

    def test_generation_comparison_rejects_replaced_hold(self):
        state = {'protocol': 2, 'durable': True, 'paused': True, 'holds': ['admin-deployment'],
                 'deployment_generation': 'a' * 32}
        with patch.object(module, 'read_record_details', return_value=('배포 보류 설정 확인; 시작 확인 미완료', 'a' * 32)):
            self.assertTrue(module.matches_recorded_generation('/fixture', state))
            state['deployment_generation'] = 'b' * 32
            self.assertFalse(module.matches_recorded_generation('/fixture', state))
            state['deployment_generation'] = 'a' * 32
            state['paused'] = False
            self.assertFalse(module.matches_recorded_generation('/fixture', state))

    def test_release_comparison_requires_expected_identity_and_verifier(self):
        commit, digest = 'a' * 40, 'b' * 64
        release = {'event': 'release', 'commit': commit, 'sha256': digest}
        with patch.object(module, 'read_record_snapshot', return_value=('state', 'c' * 32, release)):
            self.assertTrue(module.matches_release_record('/fixture', commit, digest, lambda *_: True))
            self.assertFalse(module.matches_release_record('/fixture', commit, digest, lambda *_: False))
            self.assertFalse(module.matches_release_record('/fixture', 'd' * 40, digest, lambda *_: True))
            with self.assertRaises(ValueError):
                module.matches_release_record('/fixture', commit, digest, None)

    def test_release_and_generation_require_same_snapshot(self):
        commit, digest, generation = 'a' * 40, 'b' * 64, 'c' * 32
        release = {'event': 'release', 'commit': commit, 'sha256': digest}
        state = {'protocol': 2, 'durable': True, 'paused': True, 'holds': ['admin-deployment'],
                 'deployment_generation': generation}
        snapshot = ('배포 보류 설정 확인; 시작 확인 미완료', generation, release)
        with patch.object(module, 'read_record_snapshot', return_value=snapshot) as read:
            self.assertTrue(module.matches_release_and_generation('/fixture', commit, digest, lambda *_: True, state))
            self.assertEqual(read.call_count, 1)
            self.assertFalse(module.matches_release_and_generation('/fixture', commit, digest, lambda *_: False, state))
            state['deployment_generation'] = 'd' * 32
            self.assertFalse(module.matches_release_and_generation('/fixture', commit, digest, lambda *_: True, state))


if __name__ == '__main__':
    unittest.main()
