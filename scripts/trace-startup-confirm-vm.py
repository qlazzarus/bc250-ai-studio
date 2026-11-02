#!/usr/bin/env python3
"""Run the actual startup confirmation with safe failure-stage reporting in the test VM."""
import asyncio
import functools
import inspect
import os
import socket
import subprocess

from app.core.files import FileLock
from app.services import gate_admin
from app.services.model_control_bridge import ModelControlClient
from app.services.model_switch import SwitchJournal
from app.services.systemd_model import SystemdModelService


def output(command):
    return subprocess.run(command, check=True, capture_output=True, text=True, timeout=10).stdout.strip()


if (os.geteuid() != 0 or socket.gethostname() != 'bc250-fedora43-test'
        or output(['/usr/bin/systemd-detect-virt']) != 'qemu'
        or output(['/usr/sbin/getenforce']) != 'Enforcing'):
    raise SystemExit('격리 시험 VM에서만 실행할 수 있습니다.')

failure = []


def trace(owner, name, label):
    original = getattr(owner, name)
    if inspect.iscoroutinefunction(original):
        @functools.wraps(original)
        async def wrapper(*args, **kwargs):
            try:
                return await original(*args, **kwargs)
            except Exception as error:
                if not failure:
                    failure.append((label, type(error).__name__))
                raise
    else:
        @functools.wraps(original)
        def wrapper(*args, **kwargs):
            try:
                return original(*args, **kwargs)
            except Exception as error:
                if not failure:
                    failure.append((label, type(error).__name__))
                raise
    setattr(owner, name, wrapper)


trace(FileLock, 'acquire', 'GPU 잠금')
trace(SwitchJournal, 'read', 'journal 읽기')
trace(ModelControlClient, 'request', '작업자 요청')
trace(gate_admin, 'check_studio_protocol', 'Studio 조율 API')
trace(gate_admin, 'check_gate_identity', 'gate 역할 확인')
trace(gate_admin, 'coordinated_participants_are_ready', 'Studio·gate·Client 조율')
trace(gate_admin.GateAdministrator, 'gate', 'gate 상태')
trace(gate_admin.GateAdministrator, 'drain', '요청 drain')
trace(SystemdModelService, 'ensure_settled', 'llama 서비스 상태')
trace(SystemdModelService, 'healthy', '모델 health')
trace(gate_admin.GateAdministrator, 'update_administrator_hold', 'startup 보류 해제')
try:
    asyncio.run(gate_admin.run_confirm('confirm-startup', expected_client_user='vmtest'))
except Exception as error:
    label, kind = failure[0] if failure else ('준비 또는 조건 검사', type(error).__name__)
    # Exception messages and request data may contain credentials; never print them.
    if not kind.isidentifier() or not kind.isascii():
        kind = 'UnknownError'
    print(f'시험 startup 확인 실패: 단계={label}, 예외={kind}', flush=True)
    raise SystemExit(1) from None
print('시험 startup 확인 완료', flush=True)
