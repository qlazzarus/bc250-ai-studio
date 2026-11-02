#!/usr/bin/env bash
# Kill the worker while a mock systemd restart is still running in the VM.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test ]] || {
  echo '시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 QEMU 시험 VM이 아닙니다.' >&2; exit 1;
}
[[ $# == 1 && -f "$1/backend/app/services/model_control_runtime.py" \
  && -f "$1/systemd/bc250-gpu-lock.conf" ]] || {
  echo '시험 소스가 필요합니다.' >&2; exit 1;
}
source_dir=$1
candidate=/opt/bc250-inflight-crash-candidate
worker_dropin=/etc/systemd/system/bc250-model-worker.service.d/90-inflight-crash-test.conf
llm_dropin=/etc/systemd/system/llama-server.service.d/90-inflight-crash-test.conf
worker_backup=/etc/bc250-model-control/worker.env.before-inflight-crash-test
for path in "$candidate" "$worker_dropin" "$llm_dropin" "$worker_backup"; do
  [[ ! -e "$path" && ! -L "$path" ]] || { echo "이미 존재합니다: $path" >&2; exit 1; }
done
[[ -z $(find "$source_dir/backend" -type l -print -quit) ]] || {
  echo '시험 소스에 심볼릭 링크가 있습니다.' >&2; exit 1;
}
for unit in bc250-llm-gate.service bc250-ai-studio.service llama-server.service \
  bc250-model-worker.socket bc250-model-api.service; do
  if systemctl is-active --quiet "$unit"; then
    echo "시험 서비스가 이미 실행 중입니다: $unit" >&2; exit 1
  fi
done
[[ $(cat /etc/bc250-model-control/worker.env) == 'MODEL_CONTROL_SWITCH_ENABLED=false' ]] || {
  echo '시험 작업자의 전환 기능이 꺼져 있지 않습니다.' >&2; exit 1;
}
[[ $(cat /opt/ai/config/active-model.conf) == 'ACTIVE_MODEL=fake-next' ]] || {
  echo '시험 활성 모델이 예상과 다릅니다.' >&2; exit 1;
}
[[ $(systemctl show llama-server.service -p ExecStart --value) == *'/test-fixture/mock_llm.py'* ]] || {
  echo '시험용 LLM 서비스가 아닙니다.' >&2; exit 1;
}
trap 'echo "시험이 중단됐습니다. VM 상태와 기록을 보존하고 출력을 확인하세요." >&2' ERR

install -d -o root -g root -m 0755 "$candidate"
cp -R --no-preserve=ownership "$source_dir/backend" "$candidate/backend"
chmod -R go-w "$candidate/backend"
cat > "$candidate/worker_entry.py" <<'PY'
import sys
sys.path.insert(0, '/opt/bc250-inflight-crash-candidate/backend')
from app.services.model_control_runtime import main
main()
PY
cat > "$candidate/fail_target.py" <<'PY'
import time
from pathlib import Path
candidate = Path('/opt/bc250-inflight-crash-candidate')
if Path('/opt/ai/config/active-model.conf').read_text().strip() == 'ACTIVE_MODEL=fake':
    (candidate / 'restart-started').write_text('started\n')
    deadline = time.monotonic() + 240
    while not (candidate / 'restart-release').exists():
        if time.monotonic() >= deadline:
            raise SystemExit('시험용 재시작 대기 시간 초과')
        time.sleep(0.25)
PY
chmod 0644 "$candidate/worker_entry.py" "$candidate/fail_target.py"
install -d -o root -g root -m 0755 "$(dirname "$worker_dropin")" "$(dirname "$llm_dropin")"
cat > "$worker_dropin" <<'EOF'
[Service]
ExecStart=
ExecStart=/opt/bc250-model-control/.venv/bin/python -I /opt/bc250-inflight-crash-candidate/worker_entry.py
InaccessiblePaths=/etc/bc250-model-control/client-gate.env
EOF
cat > "$llm_dropin" <<'EOF'
[Service]
TimeoutStartSec=300
ExecStartPre=/usr/bin/python3 -I /opt/bc250-inflight-crash-candidate/fail_target.py
EOF
chmod 0644 "$worker_dropin" "$llm_dropin"
cp -p /etc/bc250-model-control/worker.env "$worker_backup"
printf 'MODEL_CONTROL_SWITCH_ENABLED=true\nMODEL_CONTROL_HEALTH_TIMEOUT=30\nMODEL_CONTROL_SETTLE_TIMEOUT=60\n' \
  > /etc/bc250-model-control/worker.env
restorecon -RF "$candidate" "$(dirname "$worker_dropin")" "$(dirname "$llm_dropin")"
if [[ ! -e /run/bc250-gpu ]]; then
  systemd-tmpfiles --create "$source_dir/systemd/bc250-gpu-lock.conf"
fi
systemctl daemon-reload
systemctl start bc250-llm-gate.service llama-server.service bc250-model-worker.socket \
  bc250-ai-studio.service bc250-model-api.service

python3 - <<'PY'
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
directory = Path('/etc/bc250-model-control')
keys = {
    'gate': (directory / 'gate-admin-key').read_text().strip(),
    'studio': (directory / 'studio-coordination-key').read_text().strip(),
    'api': (directory / 'api-key').read_text().strip(),
}
targets = (
    ('http://127.0.0.1:8081/control', keys['gate'], 'gate'),
    ('http://127.0.0.1:8090/internal/model-switch/coordination', keys['studio'], 'studio'),
    ('http://127.0.0.1:8091/api/v1/llm/models', keys['api'], 'api'),
)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for url, key, kind in targets:
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key})
    for attempt in range(24):
        try:
            with opener.open(request, timeout=15) as response:
                result = json.load(response)
            if kind == 'gate':
                assert result['paused'] and {'startup', 'legacy'}.issubset(result['holds'])
            elif kind == 'studio':
                if result != {'protocol': 1, 'enabled': True, 'transition_clear': True}:
                    raise ValueError('조율 준비 전')
            elif result.get('current') != 'fake-next':
                raise ValueError('목록 준비 전')
            break
        except urllib.error.HTTPError as error:
            if error.code != 503:
                raise SystemExit(f'시험 서비스 오류: HTTP {error.code}') from None
        except (OSError, ValueError):
            pass
        print(f'{kind} 준비 대기 {attempt + 1}/24', flush=True)
        time.sleep(5)
    else:
        raise SystemExit(f'{kind} 준비 상태를 확인하지 못했습니다.')
print('시험 gate·Studio·관리 API 준비 확인')
PY

python=/opt/bc250-model-control/.venv/bin/python
"$python" -I -c \
  "import sys; sys.path.insert(0, '$candidate/backend'); from app.services.gate_admin import main; main()" \
  confirm-startup

python3 - <<'PY'
import json
import os
import signal
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
status, operation = request(base + '/switches', api_key, {'model': 'fake'}, 'vm-inflight-crash-v1')
assert status == 202 and 'id' in operation, (status, operation)
operation_id = operation['id']
url = base + '/switches/' + operation['id']

candidate = Path('/opt/bc250-inflight-crash-candidate')
started = candidate / 'restart-started'
release = candidate / 'restart-release'
journal_path = Path('/var/lib/bc250-model-control/switch.json')
for attempt in range(240):
    if started.is_file():
        break
    time.sleep(0.5)
else:
    raise SystemExit('시험용 systemd 재시작 시작을 확인하지 못했습니다.')
assert not release.exists()
journal = json.loads(journal_path.read_text())
assert journal['old'] == 'fake-next' and journal['target'] == 'fake'
assert journal['operation_id'] == operation_id and journal['mutation_started'] is True
hold_id = journal['hold_id']
status, gate = request('http://127.0.0.1:8081/control', gate_key)
assert status == 200 and gate['paused'] and set(gate['holds']) == {'legacy', hold_id}

def properties(unit):
    output = subprocess.check_output(
        ['systemctl', 'show', '--all', unit,
         '-p', 'ActiveState', '-p', 'MainPID', '-p', 'Job'], text=True, timeout=10
    )
    return dict(line.split('=', 1) for line in output.splitlines() if '=' in line)

llm_state = properties('llama-server.service')
assert llm_state['ActiveState'] == 'activating' and llm_state['Job'], llm_state
worker_pid = int(properties('bc250-model-worker.service')['MainPID'])
assert worker_pid > 1
os.kill(worker_pid, signal.SIGKILL)
print('systemd 재시작이 진행 중인 상태에서 시험 작업자 강제 종료', flush=True)

for attempt in range(36):
    time.sleep(5)
    try:
        status, operation = request(url, api_key)
    except (OSError, TimeoutError):
        continue
    current_pid = int(properties('bc250-model-worker.service')['MainPID'])
    if status == 200 and operation['state'] == 'recovery_required' and current_pid > 1 and current_pid != worker_pid:
        break
else:
    raise SystemExit('작업자 재시작 후 복구 필요 상태를 확인하지 못했습니다.')
assert json.loads(journal_path.read_text()) == journal
status, gate = request('http://127.0.0.1:8081/control', gate_key)
assert status == 200 and gate['paused'] and set(gate['holds']) == {'legacy', hold_id}
assert properties('llama-server.service')['Job'] and not release.exists()
print('작업자 재시작 후 journal과 두 보류 유지 확인', flush=True)

python = '/opt/bc250-model-control/.venv/bin/python'
entry = (
    "import sys; sys.path.insert(0, '/opt/bc250-inflight-crash-candidate/backend'); "
    'from app.services.model_control_admin import main; main()'
)

def recover():
    result = subprocess.run(
        [python, '-I', '-c', entry, 'recover', operation_id],
        check=True, capture_output=True, text=True, timeout=30,
    )
    assert json.loads(result.stdout)['id'] == operation_id

recover()
saw_rollback = False
for attempt in range(36):
    time.sleep(5)
    status, operation = request(url, api_key)
    if status != 200:
        continue
    if operation['state'] == 'rolling_back':
        saw_rollback = True
    elif operation['state'] == 'recovery_required' and saw_rollback:
        break
    elif operation['state'] in {'succeeded', 'failed', 'failed_rolled_back'}:
        raise SystemExit('systemd 작업 종료 전 복구가 잘못 완료됐습니다.')
else:
    raise SystemExit('진행 중인 systemd 작업에 대한 복구 차단을 확인하지 못했습니다.')
assert properties('llama-server.service')['Job'] and not release.exists()
assert json.loads(journal_path.read_text()) == journal
assert Path('/opt/ai/config/active-model.conf').read_text().strip() == 'ACTIVE_MODEL=fake'
status, gate = request('http://127.0.0.1:8081/control', gate_key)
assert status == 200 and gate['paused'] and set(gate['holds']) == {'legacy', hold_id}
print('systemd 작업이 끝나기 전 복구가 차단되고 상태가 유지됨을 확인', flush=True)

release.write_text('continue\n')
for attempt in range(36):
    state = properties('llama-server.service')
    if state['ActiveState'] == 'active' and state['MainPID'] != '0' and not state['Job']:
        break
    time.sleep(5)
else:
    raise SystemExit('시험용 systemd 재시작이 끝나지 않았습니다.')
print('시험용 systemd 재시작 종료 확인', flush=True)

time.sleep(2)
recover()
saw_rollback = False
for attempt in range(36):
    time.sleep(5)
    status, operation = request(url, api_key)
    if status == 200 and operation['state'] == 'rolling_back':
        saw_rollback = True
    if status == 200 and operation['state'] == 'failed_rolled_back':
        break
    if status == 200 and (operation['state'] in {'succeeded', 'failed'} or
                          (operation['state'] == 'recovery_required' and saw_rollback)):
        raise SystemExit('systemd 작업 종료 후 복구가 실패했습니다: ' + operation['state'])
else:
    raise SystemExit('systemd 작업 종료 후 복구 완료를 확인하지 못했습니다.')

assert Path('/opt/ai/config/active-model.conf').read_text().strip() == 'ACTIVE_MODEL=fake-next'
assert json.loads(journal_path.read_text()) == {}
status, gate = request('http://127.0.0.1:8081/control', gate_key)
assert status == 200 and gate['paused'] and gate['holds'] == ['legacy'], gate
with opener.open('http://127.0.0.1:8080/health', timeout=10) as response:
    assert response.status == 200 and json.load(response)['status'] == 'ok'
print('systemd 작업 종료 후 이전 모델 health, 빈 journal 및 legacy 보류 유지 확인')
PY

# Only after successful, verified recovery restore the VM's previous test setup.
systemctl stop bc250-model-api.service bc250-model-worker.socket bc250-model-worker.service
cp -p "$worker_backup" /etc/bc250-model-control/worker.env
mv "$worker_dropin" "$candidate/worker-dropin.saved"
mv "$llm_dropin" "$candidate/llm-dropin.saved"
systemctl daemon-reload
echo '시험 작업자 전환 기능을 다시 끄고 시험용 systemd 설정을 보관했습니다.'
