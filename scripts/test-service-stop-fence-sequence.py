#!/usr/bin/env python3
"""Failure-path tests of callback ordering, not systemd or a DB fence."""
import importlib.util
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/service-stop-fence-sequence.py'
spec = importlib.util.spec_from_file_location('service_fence_sequence', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SequenceTest(unittest.TestCase):
    def test_record_classification_rejects_unknown_or_invalid_order(self):
        full = ['service_restart_disable:begin', 'service_restart_disable:confirmed',
                'service_start_block:begin', 'service_start_block:confirmed',
                'service_stop_fence:begin', 'service_stop_fence:confirmed']
        self.assertEqual(module.classify_record([]), '시작 기록 없음')
        self.assertEqual(module.classify_record(full[:1]), '작업 결과 미확인')
        self.assertEqual(module.classify_record(full), '단계 완료 기록 있음')
        self.assertEqual(module.classify_record(full + ['service_stop_fence:lost']), '차단 상실 기록 있음')
        self.assertEqual(module.classify_record(['legacy_backup:begin', *full]), '단계 완료 기록 있음')
        for bad in (['service_stop_fence:confirmed'], full + ['service_stop_fence:lost'] * 2,
                    full + ['service_start_block:unknown'], [None]):
            with self.subTest(events=bad), self.assertRaises(ValueError):
                module.classify_record(bad)

    def runner(self, fail_at=None):
        calls = []
        events = []
        def callback(name):
            def run():
                calls.append(name)
                return len(calls) != fail_at
            return run
        runner = module.ServiceStopFence(record=events.append,
            generation_current=callback('generation'), disable_restart=callback('restart'),
            install_start_block=callback('block'), check_policy=callback('policy'),
            stop_services=callback('stop'), check_stopped=callback('stopped'))
        return runner, calls, events

    def test_success_order_and_reuse_rejected(self):
        runner, calls, events = self.runner()
        self.assertTrue(runner.prepare())
        self.assertEqual(calls, ['generation', 'restart', 'generation', 'block', 'generation',
                                 'policy', 'generation', 'stop', 'policy', 'stopped'])
        self.assertEqual(events, ['service_restart_disable:begin', 'service_restart_disable:confirmed',
                                  'service_start_block:begin', 'service_start_block:confirmed',
                                  'service_stop_fence:begin', 'service_stop_fence:confirmed'])
        self.assertTrue(runner.check())
        with self.assertRaises(module.ServiceStopFenceError):
            runner.prepare()

    def test_each_failed_step_stops_and_cannot_retry(self):
        for index in range(1, 11):
            with self.subTest(step=index):
                runner, calls, events = self.runner(fail_at=index)
                with self.assertRaises(module.ServiceStopFenceError):
                    runner.prepare()
                self.assertEqual(len(calls), index)
                self.assertFalse(runner.check())
                with self.assertRaises(module.ServiceStopFenceError):
                    runner.prepare()

    def test_record_failure_prevents_mutation_or_confirmation(self):
        expected = [1, 3, 3, 7, 7, 10]
        for index, expected_calls in enumerate(expected, 1):
            with self.subTest(record=index):
                runner, calls, _ = self.runner()
                events = []
                def record(event):
                    events.append(event)
                    if len(events) == index:
                        raise OSError('fixture record failure')
                runner.record = record
                with self.assertRaises(module.ServiceStopFenceError):
                    runner.prepare()
                self.assertEqual(len(calls), expected_calls)
                self.assertFalse(runner.check())
                with self.assertRaises(module.ServiceStopFenceError):
                    runner.prepare()

    def test_lost_protection_cannot_be_reaccepted(self):
        runner, _, events = self.runner()
        self.assertTrue(runner.prepare())
        runner.check_policy = lambda: False
        self.assertFalse(runner.check())
        runner.check_policy = lambda: True
        self.assertFalse(runner.check())
        self.assertEqual(events.count('service_stop_fence:lost'), 1)
        with self.assertRaises(module.ServiceStopFenceError):
            runner.prepare()

    def test_check_error_fails_closed(self):
        runner, _, events = self.runner()
        self.assertTrue(runner.prepare())
        def broken():
            raise OSError('fixture failure')
        runner.check_stopped = broken
        with self.assertRaises(OSError):
            runner.check()
        runner.check_stopped = lambda: True
        self.assertFalse(runner.check())
        self.assertEqual(events.count('service_stop_fence:lost'), 1)

    def test_loss_record_failure_still_latches_failure(self):
        runner, _, _ = self.runner()
        self.assertTrue(runner.prepare())
        runner.check_policy = lambda: False
        def broken_record(_):
            raise OSError('fixture record failure')
        runner.record = broken_record
        with self.assertRaises(OSError):
            runner.check()
        runner.check_policy = lambda: True
        self.assertFalse(runner.check())


if __name__ == '__main__':
    unittest.main()
