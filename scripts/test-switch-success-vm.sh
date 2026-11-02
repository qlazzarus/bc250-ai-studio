#!/usr/bin/env bash
# Real systemd switch path, but only against disposable VM fixtures and fake files.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test ]] || {
  echo '시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $(systemd-detect-virt) == qemu ]] || { echo 'QEMU 시험 VM이 아닙니다.' >&2; exit 1; }
trap 'echo "시험이 중단됐습니다. VM의 기록과 서비스를 그대로 두고 출력을 확인하세요." >&2' ERR

worker_env=/etc/bc250-model-control/worker.env
worker_backup=/etc/bc250-model-control/worker.env.before-switch-test
mock=/opt/bc250-model-control/test-fixture/mock_llm.py
mock_backup=/opt/bc250-model-control/test-fixture/mock_llm.py.before-switch-test
config=/opt/ai/config/models/fake-next.conf
model=/opt/ai/models/fake-next.gguf
for item in "$worker_backup" "$mock_backup" "$config" "$model"; do
  [[ ! -e "$item" && ! -L "$item" ]] || { echo "이미 존재합니다: $item" >&2; exit 1; }
done
[[ -f "$mock" && ! -L "$mock" && $(stat -c '%u' "$mock") == 0 ]] || {
  echo '시험용 LLM 파일을 확인할 수 없습니다.' >&2; exit 1;
}
[[ $(cat "$worker_env") == 'MODEL_CONTROL_SWITCH_ENABLED=false' ]] || {
  echo '시험 작업자가 비활성 상태가 아닙니다.' >&2; exit 1;
}
[[ $(cat /opt/ai/config/active-model.conf) == 'ACTIVE_MODEL=fake' ]] || {
  echo '시험 활성 모델이 예상과 다릅니다.' >&2; exit 1;
}
[[ $(systemctl show llama-server.service -p ExecStart --value) == *'/test-fixture/mock_llm.py'* ]] || {
  echo '시험용 LLM 서비스가 아닙니다.' >&2; exit 1;
}

python3 - <<'PY'
import json
import urllib.request
from pathlib import Path
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
key = Path('/etc/bc250-model-control/gate-admin-key').read_text().strip()
request = urllib.request.Request('http://127.0.0.1:8081/control',
                                 headers={'Authorization': 'Bearer ' + key})
with opener.open(request, timeout=10) as response:
    state = json.load(response)
assert state['paused'] and state['holds'] == ['legacy'], state
assert json.loads(Path('/var/lib/bc250-model-control/switch.json').read_text()) == {}
print('기존 legacy 보류와 빈 전환 기록 확인')
PY
/opt/bc250-model-control/.venv/bin/python -I - <<'PY'
import asyncio
from app.services.model_control_bridge import ModelControlClient

async def main():
    response = await ModelControlClient('/run/bc250-model-control/control.sock').request('pending')
    assert response == {'operation': None}, response
    print('미완료 전환 작업 없음 확인')
asyncio.run(main())
PY

umask 077
cp -p "$worker_env" "$worker_backup"
cp -p "$mock" "$mock_backup"
printf 'MODEL_PATH=/opt/ai/models/fake-next.gguf\nMODEL_NAME=fake-next\n' > "$config"
printf 'test model two\n' > "$model"
chmod 0644 "$config" "$model"
cat > "$mock" <<'PY'
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        current = Path('/opt/ai/config/active-model.conf').read_text().strip().partition('=')[2]
        data = {'/slots': [{'is_processing': False}], '/health': {'status': 'ok'},
                '/v1/models': {'data': [{'id': '/opt/ai/models/' + current + '.gguf'}]}}.get(self.path)
        if data is None:
            self.send_error(404)
            return
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass

HTTPServer(('127.0.0.1', 8080), Handler).serve_forever()
PY
chmod 0644 "$mock"
restorecon -F "$config" "$model" "$mock"
systemctl restart llama-server.service
printf 'MODEL_CONTROL_SWITCH_ENABLED=true\n' > "$worker_env"
systemctl restart bc250-model-worker.service

python3 - <<'PY'
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

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
for attempt in range(24):
    try:
        status, models = request(base + '/models', api_key)
        if status == 200 and models['current'] == 'fake':
            break
    except (OSError, TimeoutError):
        pass
    print(f'시험 작업자 준비 대기 {attempt + 1}/24')
    time.sleep(5)
else:
    raise SystemExit('시험 작업자 시작을 확인하지 못했습니다.')

status, operation = request(base + '/switches', api_key, {'model': 'fake-next'}, 'vm-success-test')
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
assert json.loads(Path('/var/lib/bc250-model-control/switch.json').read_text()) == {}
status, gate = request('http://127.0.0.1:8081/control', gate_key)
assert status == 200 and gate['paused'] and gate['holds'] == ['legacy'], gate
print('활성 설정, 빈 journal 및 기존 legacy 보류 유지 확인')

Path('/etc/bc250-model-control/worker.env').write_text('MODEL_CONTROL_SWITCH_ENABLED=false\n')
subprocess.run(['systemctl', 'restart', 'bc250-model-worker.service'], check=True, timeout=120)
for attempt in range(24):
    try:
        status, result = request(base + '/switches', api_key, {'model': 'fake'}, 'vm-disabled-after-test')
        if status == 503 and result.get('code') == 'switch_disabled':
            break
    except (OSError, TimeoutError):
        pass
    time.sleep(5)
else:
    raise SystemExit('전환 비활성화 응답을 확인하지 못했습니다.')
print('시험 작업자의 전환 기능을 다시 비활성화했습니다.')
PY
