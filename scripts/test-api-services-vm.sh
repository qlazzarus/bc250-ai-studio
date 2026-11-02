#!/usr/bin/env bash
# Exercise installed VM services only; keep switch disabled and holds intact.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ ($# == 1 || $# == 2 || $# == 3) && -f $1/systemd/bc250-gpu-lock.conf ]] || {
  echo '시험용 tmpfiles 구성이 없습니다.' >&2; exit 1;
}
python=/opt/bc250-model-control/.venv/bin/python
studio_python=$python
if [[ $# -ge 2 ]]; then python=$2/.venv/bin/python; studio_python=$python; fi
if [[ $# == 3 ]]; then studio_python=$3/.venv/bin/python; fi
units=(bc250-ai-studio.service bc250-llm-gate.service llama-server.service \
  bc250-model-worker.socket bc250-model-worker.service bc250-model-api.service)
for unit in "${units[@]}"; do
  [[ $(systemctl show "$unit" -p LoadState --value) == loaded \
    && $(systemctl show "$unit" -p ActiveState --value) == inactive \
    && -z $(systemctl show "$unit" -p Job --value) ]] || {
    echo "시험 서비스가 정지 상태가 아닙니다: $unit" >&2; exit 1;
  }
done
for path in /run/systemd/system/bc250-llm-client.service \
  /etc/systemd/system/bc250-llm-client.service; do
  [[ ! -e $path && ! -L $path ]] || { echo '시험 Client unit이 이미 존재합니다.' >&2; exit 1; }
done
for port in 8080 8081 8090 8091; do
  [[ -z $(ss -H -ltn "sport = :$port") ]] || { echo "시험 포트 사용 중: $port" >&2; exit 1; }
done
[[ -x $python && -x $studio_python ]] || {
  echo '시험 가상환경 Python을 실행할 수 없습니다.' >&2; exit 1;
}
for path in /etc/bc250-model-control/client-gate.env \
  /etc/bc250-model-control/api-key /etc/bc250-model-control/worker.env \
  /var/lib/bc250-model-control/switch.json /var/lib/bc250-llm-gate/holds.json; do
  [[ -f $path && ! -L $path ]] || { echo "시험 파일이 없습니다: $path" >&2; exit 1; }
done
evidence=$(mktemp -d /var/backups/bc250-api-service-test.XXXXXXXX)
trap 'echo "시험 중단. 서비스와 상태를 보존합니다: $evidence" >&2' ERR
for path in /var/lib/bc250-model-control/switch.json \
  /var/lib/bc250-model-control/operations.sqlite3 \
  /var/lib/bc250-model-control/operations.sqlite3-wal \
  /var/lib/bc250-model-control/operations.sqlite3-shm \
  /var/lib/bc250-llm-gate/holds.json; do
  if [[ -e $path ]]; then
    [[ -f $path && ! -L $path ]] || { echo '시험 상태 파일 형식이 다릅니다.' >&2; exit 1; }
    cp -a -- "$path" "$evidence/"
  fi
done
python3 - "$evidence" <<'PY'
import json
import sqlite3
import sys
from pathlib import Path

evidence = Path(sys.argv[1])
if json.loads((evidence / 'switch.json').read_text()) != {}:
    raise SystemExit('시험 journal이 비어 있지 않습니다. 보존하고 중단합니다.')
holds = json.loads((evidence / 'holds.json').read_text())
if not isinstance(holds, dict) or not isinstance(holds.get('holds'), list):
    raise SystemExit('시험 gate 상태 형식이 다릅니다.')
database = Path('/var/lib/bc250-model-control/operations.sqlite3')
if database.exists():
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as db:
        pending = db.execute("SELECT COUNT(*) FROM switch_operations WHERE state IN "
                             "('queued','waiting_for_gpu','pausing','draining','switching',"
                             "'verifying','rolling_back','recovery_required')").fetchone()[0]
    if pending:
        raise SystemExit('시험 작업 DB에 미완료 작업이 있습니다. 보존하고 중단합니다.')
print('시험 journal과 미완료 작업 확인; 기존 gate 상태 백업 완료')
PY
if [[ ! -e /run/bc250-gpu && ! -L /run/bc250-gpu ]]; then
  systemd-tmpfiles --create "$1/systemd/bc250-gpu-lock.conf"
  echo '시험 VM의 임시 GPU 잠금 파일 생성 완료'
fi
[[ -d /run/bc250-gpu && ! -L /run/bc250-gpu ]] || {
  echo '시험 GPU 잠금 디렉터리가 올바르지 않습니다.' >&2; exit 1;
}
for path in /run/bc250-gpu/gpu.lock /run/bc250-gpu/model-worker.lock; do
  [[ -f $path && ! -L $path ]] || {
    echo "시험 GPU 잠금 구성이 불완전합니다. 기존 상태를 보존합니다: $path" >&2; exit 1;
  }
done
unit=/run/systemd/system/bc250-llm-client.service
cat > "$unit" <<'EOF'
[Unit]
Description=Disposable client process for API integration test
[Service]
Type=simple
User=vmtest
Group=vmtest
EnvironmentFile=/etc/bc250-model-control/client-gate.env
ExecStart=/usr/bin/sleep 600
KillMode=control-group
EOF
restorecon -F "$unit"
systemctl daemon-reload
systemctl start llama-server.service bc250-llm-gate.service bc250-ai-studio.service \
  bc250-llm-client.service bc250-model-worker.socket bc250-model-api.service
python3 - <<'PY'
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

url = 'http://127.0.0.1:8091/api/v1/llm/models'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _ in range(60):
    try:
        with opener.open(url, timeout=3):
            raise SystemExit('인증 없는 모델 API가 허용됐습니다.')
    except urllib.error.HTTPError as error:
        if error.code == 401:
            break
        raise SystemExit(f'인증 확인 실패: HTTP {error.code}') from None
    except OSError:
        time.sleep(2)
else:
    raise SystemExit('시험 관리 API 준비 시간 초과')
key = Path('/etc/bc250-model-control/api-key').read_text().strip()
request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key})
for _ in range(30):
    try:
        with opener.open(request, timeout=10) as response:
            models = json.load(response)
        break
    except urllib.error.HTTPError as error:
        if error.code != 503:
            raise SystemExit(f'시험 모델 목록 오류: HTTP {error.code}') from None
        time.sleep(2)
else:
    raise SystemExit('시험 작업자의 모델 목록 준비 시간 초과')
if not models.get('models'):
    raise SystemExit('시험 모델 목록이 비었습니다.')
print('시험 관리 API의 미인증 거절과 인증된 모델 목록 확인')
PY
python3 - <<'PY'
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

key = Path('/etc/bc250-model-control/studio-coordination-key').read_text().strip()
request = urllib.request.Request('http://127.0.0.1:8090/internal/model-switch/coordination',
                                 headers={'Authorization': 'Bearer ' + key})
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _ in range(30):
    try:
        with opener.open(request, timeout=5) as response:
            result = json.load(response)
        if result == {'protocol': 1, 'enabled': True, 'transition_clear': True}:
            print('시험 Studio의 인증된 조율 준비 상태 확인')
            break
    except urllib.error.HTTPError as error:
        raise SystemExit(f'시험 Studio 조율 인증 오류: HTTP {error.code}') from None
    except OSError:
        pass
    time.sleep(2)
else:
    raise SystemExit('시험 Studio 조율 준비를 확인하지 못했습니다.')
PY
if [[ $# -ge 2 ]]; then
  python3 - "$python" "$studio_python" <<'PY'
import subprocess
import sys
from pathlib import Path

worker_python, studio_python = (arg.encode() for arg in sys.argv[1:3])
for unit in ('bc250-ai-studio.service', 'bc250-llm-gate.service',
             'bc250-model-worker.service', 'bc250-model-api.service'):
    pid = subprocess.check_output(['systemctl', 'show', unit, '-p', 'MainPID', '--value'],
                                  text=True).strip()
    if not pid.isdigit() or int(pid) <= 1:
        raise SystemExit(f'시험 서비스 PID 확인 실패: {unit}')
    args = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
    expected = studio_python if unit == 'bc250-ai-studio.service' else worker_python
    if not args or args[0] != expected:
        raise SystemExit(f'현재 후보 Python 실행 확인 실패: {unit}')
print('gate·Studio·작업자·관리 API가 현재 후보로 실행 중임을 확인')
PY
fi
"$python" -I -m app.services.client_gate_check --expected-user vmtest
"$python" -I -m app.services.model_control_admin pending > "$evidence/pending.json"
python3 - "$evidence" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

evidence = Path(sys.argv[1])
if json.loads((evidence / 'pending.json').read_text()) != {'operation': None}:
    raise SystemExit('시험 작업자에 미완료 작업이 있습니다.')
pid = subprocess.check_output(['systemctl', 'show', 'bc250-model-worker.service',
                               '-p', 'MainPID', '--value'], text=True).strip()
if not pid.isdigit() or int(pid) <= 1:
    raise SystemExit('시험 작업자 PID를 확인하지 못했습니다.')
entries = Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
values = [item for item in entries if item.startswith(b'MODEL_CONTROL_SWITCH_ENABLED=')]
if values != [b'MODEL_CONTROL_SWITCH_ENABLED=false']:
    raise SystemExit('시험 작업자의 전환 비활성 설정을 확인하지 못했습니다.')
old = set(json.loads((evidence / 'holds.json').read_text())['holds'])
current = set(json.loads(Path('/var/lib/bc250-llm-gate/holds.json').read_text())['holds'])
if not old.issubset(current) or 'startup' not in current:
    raise SystemExit('시험 gate 시작 보류 또는 기존 보류를 확인하지 못했습니다.')
print('시험 작업자 전환 비활성·빈 작업 상태와 기존 gate 보류 유지 확인')
PY
# The deliberately absent model cannot initiate a model switch even if an
# unexpected configuration error were to enable the submit path.
python3 - <<'PY'
import json
import urllib.error
import urllib.request
from pathlib import Path

key = Path('/etc/bc250-model-control/api-key').read_text().strip()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
headers = {'Authorization': 'Bearer ' + key}
with opener.open(urllib.request.Request('http://127.0.0.1:8091/api/v1/llm/models', headers=headers), timeout=10) as response:
    models = json.load(response)['models']
name = 'fixture_nonexistent_9c834f3c'
if any(model.get('name') == name for model in models):
    raise SystemExit('시험 전용 모델 이름이 이미 존재합니다.')
request = urllib.request.Request('http://127.0.0.1:8091/api/v1/llm/switches',
    data=json.dumps({'model': name}).encode(), method='POST',
    headers={**headers, 'Content-Type': 'application/json', 'Idempotency-Key': 'fixture-disabled-check'})
try:
    opener.open(request, timeout=10)
except urllib.error.HTTPError as error:
    if error.code == 503 and json.load(error) == {'code': 'switch_disabled'}:
        print('시험 관리 API가 전환 비활성 요청을 거절함을 확인')
    else:
        raise SystemExit(f'시험 전환 비활성 응답 확인 실패: HTTP {error.code}') from None
else:
    raise SystemExit('시험 전환 요청이 거절되지 않았습니다.')
PY
for name in bc250-ai-studio.service bc250-llm-gate.service llama-server.service \
  bc250-llm-client.service bc250-model-worker.socket bc250-model-worker.service \
  bc250-model-api.service; do
  systemctl is-active --quiet "$name" || {
    echo "시험 중 서비스가 종료됐습니다: $name" >&2; exit 1;
  }
done
systemctl stop bc250-model-api.service bc250-model-worker.socket bc250-model-worker.service \
  bc250-llm-client.service bc250-ai-studio.service bc250-llm-gate.service llama-server.service
rm -- "$unit"
systemctl daemon-reload
echo "시험 서비스 정지 완료. 보류와 시험 전 상태 보관: $evidence"
