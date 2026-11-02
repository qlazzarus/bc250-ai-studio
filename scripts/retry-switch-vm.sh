#!/usr/bin/env bash
# Retry only against the dedicated VM's fake model and fake LLM service.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test ]] || {
  echo '시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $(systemd-detect-virt) == qemu ]] || { echo 'QEMU 시험 VM이 아닙니다.' >&2; exit 1; }
trap 'echo "시험이 중단됐습니다. VM 상태를 그대로 보존하고 출력을 확인하세요." >&2' ERR
[[ $(cat /etc/bc250-model-control/worker.env) == 'MODEL_CONTROL_SWITCH_ENABLED=false' ]] || {
  echo '시험 작업자의 전환 기능이 꺼져 있지 않습니다.' >&2; exit 1;
}
[[ $(cat /opt/ai/config/active-model.conf) == 'ACTIVE_MODEL=fake' ]] || {
  echo '시험 활성 모델이 예상과 다릅니다.' >&2; exit 1;
}
[[ -f /opt/ai/config/models/fake-next.conf && -f /opt/ai/models/fake-next.gguf ]] || {
  echo '가짜 모델 파일이 없습니다.' >&2; exit 1;
}
[[ $(systemctl show llama-server.service -p ExecStart --value) == *'/test-fixture/mock_llm.py'* ]] || {
  echo '시험용 LLM 서비스가 아닙니다.' >&2; exit 1;
}

/opt/bc250-model-control/.venv/bin/python -I - <<'PY'
import asyncio
import json
import os
import stat
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from app.core.files import FileLock, protected_xattrs
from app.services.model_control_bridge import ModelControlClient
from app.services.model_switch import SwitchJournal

directory = Path('/etc/bc250-model-control')
api_key = (directory / 'api-key').read_text().strip()
gate_key = (directory / 'gate-admin-key').read_text().strip()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def request(url, key, payload=None, idem=None):
    headers = {'Authorization': 'Bearer ' + key}
    if payload is not None:
        headers.update({'Content-Type': 'application/json', 'Idempotency-Key': idem})
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, headers=headers, data=data)
    try:
        with opener.open(req, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

base = 'http://127.0.0.1:8091/api/v1/llm'
status, gate = request('http://127.0.0.1:8081/control', gate_key)
assert status == 200 and gate['paused'] and gate['holds'] == ['legacy'], gate
client = ModelControlClient('/run/bc250-model-control/control.sock')
assert asyncio.run(client.request('pending')) == {'operation': None}
assert asyncio.run(client.request('submit', model='fake-next',
                                  idempotency_key='vm-retry-disabled-check')) == {'error': 'switch_disabled'}

path = Path('/var/lib/bc250-model-control/switch.json')
journal = SwitchJournal(path, secure_precreated=True)
lock = FileLock('/run/bc250-gpu/gpu.lock', secure_precreated=True)
lock.acquire()
try:
    assert journal.read() == {}
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        attrs_before = protected_xattrs(fd)
    finally:
        os.close(fd)
    context = attrs_before.get('security.selinux', b'').rstrip(b'\0')
    assert context in {b'unconfined_u:object_r:var_lib_t:s0', b'system_u:object_r:var_lib_t:s0'}
    assert 'system.posix_acl_access' not in attrs_before
    assert before.st_uid == 0 and stat.S_IMODE(before.st_mode) == 0o640 and before.st_nlink == 1
    subprocess.run(['/usr/sbin/restorecon', '-F', str(path)], check=True, timeout=30)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        after = os.fstat(fd)
        attrs_after = protected_xattrs(fd)
    finally:
        os.close(fd)
    assert (after.st_ino, after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode), after.st_nlink) == (
        before.st_ino, before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
    assert attrs_after.get('security.selinux', b'').rstrip(b'\0') == b'system_u:object_r:var_lib_t:s0'
    assert 'system.posix_acl_access' not in attrs_after and journal.read() == {}
    print('시험 VM의 빈 journal 레이블 교정 및 소유권·내용 확인', flush=True)
finally:
    lock.release()

Path('/etc/bc250-model-control/worker.env').write_text('MODEL_CONTROL_SWITCH_ENABLED=true\n')
subprocess.run(['systemctl', 'restart', 'bc250-model-worker.service'], check=True, timeout=120)

for attempt in range(24):
    try:
        status, models = request(base + '/models', api_key)
        if status == 200 and models['current'] == 'fake':
            break
    except (OSError, TimeoutError):
        pass
    print(f'시험 작업자 준비 대기 {attempt + 1}/24', flush=True)
    time.sleep(5)
else:
    raise SystemExit('시험 작업자 시작을 확인하지 못했습니다.')

status, operation = request(base + '/switches', api_key, {'model': 'fake-next'}, 'vm-success-retry-2')
assert status == 202 and 'id' in operation, (status, operation)
operation_url = base + '/switches/' + operation['id']
last = None
for attempt in range(72):
    time.sleep(5)
    try:
        status, operation = request(operation_url, api_key)
    except (OSError, TimeoutError):
        continue
    if status != 200:
        continue
    state = operation['state']
    if state != last:
        print('시험 전환 상태:', state, flush=True)
        last = state
    if state == 'succeeded':
        break
    if state in {'failed', 'failed_rolled_back', 'recovery_required'}:
        raise SystemExit('시험 전환 실패: ' + state + ' / ' + str(operation.get('error_code')))
else:
    raise SystemExit('시험 전환이 시간 안에 끝나지 않았습니다. 기록을 보존합니다.')

assert Path('/opt/ai/config/active-model.conf').read_text().strip() == 'ACTIVE_MODEL=fake-next'
assert journal.read() == {}
status, gate = request('http://127.0.0.1:8081/control', gate_key)
assert status == 200 and gate['paused'] and gate['holds'] == ['legacy'], gate
print('활성 설정, 빈 journal 및 기존 legacy 보류 유지 확인', flush=True)

Path('/etc/bc250-model-control/worker.env').write_text('MODEL_CONTROL_SWITCH_ENABLED=false\n')
subprocess.run(['systemctl', 'restart', 'bc250-model-worker.service'], check=True, timeout=120)
for attempt in range(24):
    try:
        status, result = request(base + '/switches', api_key, {'model': 'fake'}, 'vm-retry-disabled-after')
        if status == 503 and result.get('code') == 'switch_disabled':
            break
    except (OSError, TimeoutError):
        pass
    time.sleep(5)
else:
    raise SystemExit('전환 비활성화 응답을 확인하지 못했습니다.')
print('시험 작업자의 전환 기능을 다시 비활성화했습니다.')
PY
