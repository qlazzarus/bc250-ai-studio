#!/usr/bin/env bash
# Continue the interrupted VM-only API test without resetting its services or state.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 1 && -f $1/backend/app/services/client_gate_check.py ]] || exit 1
source_dir=$1
evidence=/var/backups/bc250-api-service-test.WrgKgtsW
unit=/run/systemd/system/bc250-llm-client.service
[[ -d $evidence && ! -L $evidence && $(stat -c '%u %a' "$evidence") == '0 700' \
  && -f $evidence/holds.json && -f $evidence/switch.json \
  && -f $unit && ! -L $unit && $(stat -c '%u' "$unit") == 0 ]] || {
  echo '이전 시험의 상태 또는 Client unit을 확인하지 못했습니다.' >&2; exit 1;
}
grep -Fxq 'Description=Disposable client process for API integration test' "$unit" || {
  echo '이전 시험의 Client unit이 아닙니다.' >&2; exit 1;
}
for name in bc250-ai-studio.service bc250-llm-gate.service llama-server.service \
  bc250-llm-client.service bc250-model-worker.socket bc250-model-worker.service \
  bc250-model-api.service; do
  systemctl is-active --quiet "$name" || {
    echo "이전 시험 서비스가 실행 중이 아닙니다: $name" >&2; exit 1;
  }
done
[[ -z $(find "$source_dir/backend/app" -type l -print -quit) ]] || {
  echo '검사 소스에 심볼릭 링크가 있습니다.' >&2; exit 1;
}
candidate=$(mktemp -d /opt/bc250-api-service-check.XXXXXXXX)
trap 'echo "시험 중단. 기존 서비스와 시험 기록을 보존합니다: $evidence $candidate" >&2' ERR
cp -R --no-preserve=ownership "$source_dir/backend/app" "$candidate/app"
chmod -R go-w "$candidate/app"
restorecon -RF "$candidate"
python=/opt/bc250-model-control/.venv/bin/python
"$python" -I -c \
  'import sys; sys.path.insert(0, sys.argv.pop(1)); from app.services.client_gate_check import main; main()' \
  "$candidate" --expected-user vmtest
"$python" -I -m app.services.model_control_admin pending > "$evidence/pending-resume.json"
python3 - "$evidence" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

evidence = Path(sys.argv[1])
if json.loads((evidence / 'pending-resume.json').read_text()) != {'operation': None}:
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
if json.loads(Path('/var/lib/bc250-model-control/switch.json').read_text()) != {}:
    raise SystemExit('시험 journal이 비어 있지 않습니다.')
print('시험 작업자 전환 비활성·빈 작업 상태와 기존 gate 보류 유지 확인')
PY
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
systemctl stop bc250-model-api.service bc250-model-worker.socket bc250-model-worker.service \
  bc250-llm-client.service bc250-ai-studio.service bc250-llm-gate.service llama-server.service
rm -- "$unit"
systemctl daemon-reload
echo "시험 서비스 정지 완료. 보류와 시험 전 상태 보관: $evidence"
