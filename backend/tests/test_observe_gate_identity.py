import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / 'backend/app/services/gate_process_identity.py'
spec = importlib.util.spec_from_file_location('observe_gate_identity', SCRIPT)
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


def status():
    return ('Uid:\t101 101 101 101\nGid:\t201 201 201 201\nGroups:\t201\n'
            'CapInh:\t00000000\nCapPrm:\t00000000\nCapEff:\t00000000\n'
            'CapAmb:\t00000000\nNoNewPrivs:\t1\n')


@pytest.mark.parametrize('before,after', [
    ('Uid:\t101 101 101 101', 'Uid:\t101 102 101 101'),
    ('Groups:\t201', 'Groups:\t201 202'),
    ('CapEff:\t00000000', 'CapEff:\t00000001'),
    ('NoNewPrivs:\t1', 'NoNewPrivs:\t0'),
])
def test_rejects_changed_process_permissions(before, after):
    identity.process_credentials(status(), 101, 201)
    with pytest.raises(ValueError):
        identity.process_credentials(status().replace(before, after), 101, 201)


def test_rejects_shared_uid_and_service_restart(tmp_path, monkeypatch):
    accounts = {'ai-gate': 101, 'ai-studio': 102, 'client': 103}
    monkeypatch.setattr(identity.os, 'geteuid', lambda: 0)
    monkeypatch.setattr(identity.pwd, 'getpwnam', lambda name: SimpleNamespace(pw_uid=accounts[name]))
    monkeypatch.setattr(identity.grp, 'getgrnam', lambda _: SimpleNamespace(gr_gid=201))
    (tmp_path / '123').mkdir()
    (tmp_path / '123/status').write_text(status())
    monkeypatch.setattr(identity, 'PROC', tmp_path)
    monkeypatch.setattr(identity, 'starttime', lambda _: '100')
    monkeypatch.setattr(identity, 'unit_identity', lambda *_: 123)
    assert identity.observe(client_user='client') == (123, '100', 101, 201)
    accounts['client'] = 101
    with pytest.raises(ValueError):
        identity.observe(client_user='client')
    accounts['client'] = 103
    calls = iter((123, 124))
    monkeypatch.setattr(identity, 'unit_identity', lambda *_: next(calls))
    with pytest.raises(ValueError):
        identity.observe(client_user='client')
