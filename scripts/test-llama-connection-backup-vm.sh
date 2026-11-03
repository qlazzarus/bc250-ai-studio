#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-llama-connections.XXXXXXXX)
trap 'echo "시험 중단. 시험 파일 보관: $fixture" >&2' ERR
install -m 0644 "$source_dir/deploy/model-control/legacy-backup-adapter.py" "$fixture/legacy-backup-adapter.py"
install -m 0644 "$source_dir/deploy/model-control/observe-llama-connections.py" "$fixture/observe-llama-connections.py"
python3 - "$fixture" <<'PY'
import importlib.util
import socket
import sys
import time
from pathlib import Path
from types import SimpleNamespace

root = Path(sys.argv[1])
sys.dont_write_bytecode = True
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, root / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

backup = load('backup', 'legacy-backup-adapter.py')
connections = load('connections', 'observe-llama-connections.py')
adapter = backup.LegacyBackupAdapter.__new__(backup.LegacyBackupAdapter)
adapter.check_local_idle = lambda: True
adapter.require_stopped = lambda: None
adapter.llama_connections = connections
calls = []
adapter.studio_db = SimpleNamespace(inspect=lambda *args, **kwargs: calls.append('inspect'))
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    listener.listen(2)
    connections.LLAMA_PORT = listener.getsockname()[1]
    def connect():
        client = socket.create_connection(listener.getsockname(), timeout=5)
        peer, _ = listener.accept()
        return client, peer
    def await_idle():
        deadline = time.monotonic() + 10
        while True:
            try:
                connections.check_host_llama()
                return
            except ValueError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.1)
    client, peer = connect()
    try:
        try:
            adapter.require_stopped_with_clear_database()
        except ValueError as exc:
            if '종료되지 않은 TCP 연결' not in str(exc):
                raise
        else:
            raise AssertionError('진행 중 연결을 거절하지 않았습니다.')
        assert not calls
        print('시험 연결이 남아 있으면 DB 검사와 백업 전에 중단 확인', flush=True)
    finally:
        client.close()
        peer.close()
    await_idle()
    adapter.require_stopped_with_clear_database()
    assert calls == ['inspect']
    print('시험 연결 종료 후 DB 검사 경계 통과 확인', flush=True)
    opened = []
    def during_db(*args, **kwargs):
        opened.extend(connect())
    adapter.studio_db = SimpleNamespace(inspect=during_db)
    try:
        try:
            adapter.require_stopped_with_clear_database()
        except ValueError as exc:
            if '종료되지 않은 TCP 연결' not in str(exc):
                raise
        else:
            raise AssertionError('DB 검사 중 열린 연결을 거절하지 않았습니다.')
        print('시험 DB 검사 중 새 연결 발생 시 백업 전 중단 확인', flush=True)
    finally:
        for sock in opened:
            sock.close()
print('TCP 검사는 순간 관찰입니다. 직접 호출 지속 차단·GPU·실제 DB와 백업은 모의입니다.', flush=True)
PY
trap - ERR
echo "시험 파일 보관: $fixture"
