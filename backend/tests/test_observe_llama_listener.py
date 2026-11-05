import importlib.util
import os
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/model-control/observe-llama-listener.py'
spec = importlib.util.spec_from_file_location('observe_llama_listener', SCRIPT)
listener = importlib.util.module_from_spec(spec)
spec.loader.exec_module(listener)


def table(address='0100007F', port=8080, inode='1234'):
    return ('sl local_address rem_address st\n'
            f'0: {address}:{port:04X} 00000000:0000 0A 00000000:00000000 '
            f'00:00000000 00000000 1000 0 {inode}\n')


def test_listener_rejects_unexpected_addresses_and_multiple_sockets(tmp_path, monkeypatch):
    net = tmp_path / 'net'
    net.mkdir()
    (net / 'tcp6').write_text('sl local_address rem_address st\n')
    monkeypatch.setattr(listener, 'PROC', tmp_path)
    (net / 'tcp').write_text(table())
    assert listener.snapshot(8080) == '1234'
    (net / 'tcp').write_text(table('00000000'))
    with pytest.raises(ValueError):
        listener.snapshot(8080)
    (net / 'tcp').write_text(table())
    (net / 'tcp6').write_text(table('00000000000000000000000001000000'))
    with pytest.raises(ValueError):
        listener.snapshot(8080)


def test_service_listener_requires_stable_owned_socket(tmp_path, monkeypatch):
    for name in ('1/ns', 'self/ns', '123/ns', '123/fd', 'net'):
        (tmp_path / name).mkdir(parents=True, exist_ok=True)
    (tmp_path / '1/ns/net').touch()
    os.link(tmp_path / '1/ns/net', tmp_path / 'self/ns/net')
    os.link(tmp_path / '1/ns/net', tmp_path / '123/ns/net')
    (tmp_path / '123/stat').write_text('123 (example) S ' + '1 ' * 18 + '777\n')
    (tmp_path / 'net/tcp').write_text(table())
    (tmp_path / 'net/tcp6').write_text('sl local_address rem_address st\n')
    (tmp_path / '123/fd/3').symlink_to('socket:[1234]')
    monkeypatch.setattr(listener, 'PROC', tmp_path)
    monkeypatch.setattr(listener.os, 'geteuid', lambda: 0)
    monkeypatch.setattr(listener, 'service_pid', lambda _: 123)
    assert listener.check_listener()
    (tmp_path / '123/fd/3').unlink()
    with pytest.raises(ValueError):
        listener.check_listener()
