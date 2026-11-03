#!/usr/bin/env python3
"""Exercise Studio snapshot validation with mocked service and responses."""
import importlib.util
import io
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/observe-studio-idle.py'
spec = importlib.util.spec_from_file_location('observe_studio', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
IDLE = {'recovery_required': False, 'scheduler_running': True, 'gpu_owner': None,
        'active_job': None, 'transition': {}, 'llm_recovery': {}}


class StudioObservationTest(unittest.TestCase):
    def test_busy_and_missing_state(self):
        module.require_idle_status(IDLE)
        for key, value in (('active_job', 'job'), ('gpu_owner', 'job'), ('recovery_required', True),
                           ('transition', {'stage': 'work'}), ('llm_recovery', {'error': 1}),
                           ('scheduler_running', False)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                module.require_idle_status({**IDLE, key: value})
        with self.assertRaises(ValueError):
            module.require_idle_status({})

    def test_jobs_fail_closed(self):
        module.require_finished_jobs([{'status': 'completed'}, {'status': 'interrupted'}])
        for value in ([{'status': 'queued'}], [{'status': 'running'}], [{'status': []}], [{}], {}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.require_finished_jobs(value)

    def test_pagination_and_process_identity(self):
        responses = [IDLE, [{'status': 'completed'}] * module.PAGE_SIZE, [], IDLE]
        def open_request(*_args, **_kwargs):
            return io.BytesIO(json.dumps(responses.pop(0)).encode())
        opener = SimpleNamespace(open=open_request)
        with patch.object(module.os, 'geteuid', return_value=0), \
             patch.object(module, 'service_pid', side_effect=['42', '42']), \
             patch.object(module.urllib.request, 'build_opener', return_value=opener):
            self.assertTrue(module.observe('x' * 24))
        self.assertEqual(responses, [])


if __name__ == '__main__':
    unittest.main()
