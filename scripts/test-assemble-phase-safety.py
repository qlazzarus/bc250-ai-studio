#!/usr/bin/env python3
"""Verify the assembler keeps transition and post-fence safety checks separate."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/assemble-coordinator.py'
spec = importlib.util.spec_from_file_location('assembler', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TestAssemblyPhases(unittest.TestCase):
    def run_case(self, initial, use_factory=False):
        calls = []
        state = {'fenced': False}
        def idle():
            calls.append('idle')
            result = state['fenced']
            if state.get('drop_during_idle'):
                state['fenced'] = False
            return result
        def caddy_check():
            calls.append('caddy')
            return True
        class Caddy:
            def __init__(self, source, snapshot, *, check_local_idle, check_restored):
                self.check = check_local_idle
            def transition(self, *, mode):
                if not self.check():
                    raise ValueError('transition blocked')
        class Backup:
            def __init__(self, source, snapshot, *, check_local_idle):
                self.check = check_local_idle
            def maintenance(self): return True
        class Startup:
            def __init__(self, *args, **kwargs): pass
        class Fence:
            def __init__(self, *args, **kwargs): pass
            def check(self):
                calls.append('wiki')
                return state['fenced']
        class Install:
            def __init__(self, *args, **kwargs): pass
        class Journal:
            def __init__(self, *args): pass
            def release(self, *args): pass
            def close(self): pass
        def coordinator(**kwargs): return SimpleNamespace(**kwargs)
        mods = {
            'caddy_adapter': SimpleNamespace(CaddyMaintenanceAdapter=Caddy),
            'backup_adapter': SimpleNamespace(LegacyBackupAdapter=Backup),
            'startup_adapter': SimpleNamespace(NewServiceStart=Startup),
            'configuration_adapter': SimpleNamespace(ConfigurationCheck=lambda *args: lambda: True),
            'migration_journal': SimpleNamespace(MigrationJournal=Journal),
            'migration_coordinator': SimpleNamespace(CoordinatedMigration=coordinator),
            'initial_wiki_fence': SimpleNamespace(WikiConditionFence=Fence),
            'initial_install_adapter': SimpleNamespace(InitialInstallAdapter=Install),
        }
        paths = {name: '/tmp' for name in ('displaced', 'cache', 'model_cache', 'manifest_dir')}
        bound = []
        def idle_factory(wiki):
            bound.append(wiki)
            return idle
        with patch.object(module.os, 'geteuid', return_value=0), patch.object(module, 'trusted'), \
             patch.object(module, 'load', side_effect=lambda name, _: mods[name]):
            runner, _ = module.assemble(source='/tmp/source', snapshot='/tmp/snapshot', journal_dir='/tmp/journal',
                commit='a' * 40, artifact_sha256='b' * 64, checker_sha256='c' * 64,
                expected_client_user='fixture', verify_release=lambda *_: True,
                preflight=lambda: True, check_local_idle=None if use_factory else idle,
                initial_idle_factory=idle_factory if use_factory else None, check_caddy_transition=caddy_check,
                check_restored=lambda: True, install=None if initial else lambda _: True,
                verify_new=lambda: True, verify_restored=lambda: True,
                initial_install_paths=paths if initial else None, wiki_record_dir='/tmp/wiki' if initial else None)
        if initial:
            if use_factory:
                self.assertEqual(bound, [runner.wiki_fence])
            self.assertTrue(runner.preflight())
            self.assertNotIn('idle', calls)
            runner.transition(mode='enter')
            self.assertEqual(calls, ['caddy'])
            self.assertFalse(runner.backup_adapter.check())
            self.assertEqual(calls, ['caddy', 'wiki'])
            state['fenced'] = True
            self.assertTrue(runner.backup_adapter.check())
            self.assertEqual(calls[-3:], ['wiki', 'idle', 'wiki'])
            state['drop_during_idle'] = True
            self.assertFalse(runner.backup_adapter.check())
        else:
            self.assertFalse(runner.preflight())
            self.assertEqual(calls, ['idle'])

    def test_initial_fence_order(self): self.run_case(True)
    def test_other_deployments_keep_preflight_idle(self): self.run_case(False)
    def test_factory_receives_same_wiki_fence(self): self.run_case(True, use_factory=True)


if __name__ == '__main__':
    unittest.main()
