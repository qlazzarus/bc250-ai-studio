#!/usr/bin/env python3
"""Check completed preparation records and empty state in temporary fixtures."""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/verify-initial-preparation.py'
spec = importlib.util.spec_from_file_location('verify_initial', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreparationRecordTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.record, self.state = base / 'record', base / 'state'
        self.record.mkdir(mode=0o700)
        self.state.mkdir(mode=0o750)
        self.state.chmod(0o750)
        (self.state / 'switch.json').write_text('{}\n')
        (self.state / 'switch.json').chmod(0o640)
        self.rows = [{'event': 'release', 'commit': 'a' * 40, 'sha256': 'b' * 64},
                     {'event': 'initial_preparation:begin'}, {'event': 'initial_preparation:confirmed'}]
        self.write()
        for name, value in [('STATE', self.state), ('GATE', base / 'gate'), ('CODE', base / 'code')]:
            p = patch.object(module, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(module.os, 'geteuid', return_value=0)
        p.start()
        self.addCleanup(p.stop)
        p = patch.object(module, 'trusted')
        p.start()
        self.addCleanup(p.stop)
        p = patch.object(module.grp, 'getgrnam', return_value=SimpleNamespace(gr_gid=os.getgid()))
        p.start()
        self.addCleanup(p.stop)
    def write(self):
        path = self.record / 'migration-events.jsonl'
        path.write_text(''.join(json.dumps(row) + '\n' for row in self.rows))
        path.chmod(0o600)

    def test_completed_and_incomplete(self):
        # Only file-owner enforcement is bypassed for a non-root local fixture.
        real_fstat = os.fstat
        def fixture_stat(fd):
            result = real_fstat(fd)
            return SimpleNamespace(st_mode=result.st_mode, st_uid=0, st_nlink=result.st_nlink,
                                   st_size=result.st_size)
        with patch.object(module.os, 'fstat', side_effect=fixture_stat):
            self.assertTrue(module.verify(self.record, 'a' * 40, 'b' * 64))
            self.rows.pop()
            self.write()
            with self.assertRaises(ValueError):
                module.verify(self.record, 'a' * 40, 'b' * 64)
            self.rows.append({'event': 'initial_preparation:confirmed'})
            self.write()
            with self.assertRaises(ValueError):
                module.verify(self.record, 'c' * 40, 'b' * 64)
            (self.state / 'switch.json').write_text('{"work":1}\n')
            with self.assertRaises(ValueError):
                module.verify(self.record, 'a' * 40, 'b' * 64)


if __name__ == '__main__':
    unittest.main()
