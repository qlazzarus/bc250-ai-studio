#!/usr/bin/env python3
"""Check that startup uses the correct fail-closed safety callback per phase."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/start-new-services.py'
spec = importlib.util.spec_from_file_location('startup_phase_checks', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StartupPhaseTest(unittest.TestCase):
    def runner(self, state, calls):
        def idle():
            calls.append('idle')
            return state['idle']
        def running():
            calls.append('running')
            return state['running']
        with patch.object(module.os, 'geteuid', return_value=0):
            return module.NewServiceStart('/fixture/backup-archive.sh',
                check_maintenance=lambda: True, check_release=lambda: True,
                check_local_idle=idle, check_running=running,
                check_configuration=lambda: True, expected_client_user='fixture')

    def test_start_and_finish_use_distinct_checks(self):
        state = {'idle': True, 'running': True}
        calls = []
        runner = self.runner(state, calls)
        with patch.object(module, 'trusted_file'), patch.object(module, 'command'), \
             patch.object(module, 'socket_stopped'), patch.object(module, 'api_ready'), \
             patch.object(module, 'worker_disabled'), patch.object(module, 'wait_for_coordination'), \
             patch.object(module, 'ENABLE_LINKS', ()), patch('builtins.print'):
            runner.start()
            self.assertEqual(calls, ['idle', 'idle'])
            calls.clear()
            state['idle'] = False
            runner.finish()
            self.assertEqual(calls, ['running', 'running', 'running'])

    def test_failed_running_check_stops_before_service_commands(self):
        runner = self.runner({'idle': True, 'running': False}, [])
        with patch.object(module, 'trusted_file'), patch.object(module, 'command') as command:
            with self.assertRaises(module.StartupError):
                runner.finish()
            command.assert_not_called()

    def test_running_safety_loss_stops_before_enable_and_confirmation(self):
        state = {'idle': True, 'running': True}
        calls = []
        runner = self.runner(state, calls)
        def lose_safety():
            state['running'] = False
        with patch.object(module, 'trusted_file'), patch.object(module, 'command') as command, \
             patch.object(module, 'api_ready', side_effect=lose_safety), \
             patch.object(module, 'worker_disabled'), patch.object(module, 'wait_for_coordination'), \
             patch.object(module, 'ENABLE_LINKS', ()):
            with self.assertRaises(module.StartupError):
                runner.finish()
            self.assertEqual(len(command.call_args_list), 1)
            self.assertIn('app.services.client_gate_check', command.call_args_list[0].args[0])

    def test_missing_running_checker_is_rejected(self):
        with patch.object(module.os, 'geteuid', return_value=0):
            with self.assertRaises(ValueError):
                module.NewServiceStart('/fixture/backup-archive.sh', check_maintenance=lambda: True,
                    check_release=lambda: True, check_local_idle=lambda: True, check_running=None,
                    check_configuration=lambda: True, expected_client_user='fixture')


if __name__ == '__main__':
    unittest.main()
