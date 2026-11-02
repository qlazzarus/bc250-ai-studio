#!/usr/bin/env bash
# Finish the specifically identified interrupted startup fixture, on its VM only.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 2 && $1 =~ ^/opt/bc250-installed-studio-entry\.[[:alnum:]]{8}$ \
  && $2 =~ ^/var/backups/bc250-startup-phases\.[[:alnum:]]{8}$ ]] || exit 1
entry=$1
evidence=$2
[[ -d $entry && ! -L $entry && -d $evidence && ! -L $evidence ]] || exit 1
python3 - "$entry" "$evidence" <<'PY'
import json
import sys
from pathlib import Path

entry, evidence = map(Path, sys.argv[1:])
unitdir = Path('/run/systemd/system')
worker = '/opt/bc250-current-code-candidate.YS6DiOo6'
studio = '/opt/bc250-studio-fixture-gkewmda1'
expected = {
    'bc250-ai-studio.service.d/zz-bc250-installed-test.conf': f'[Service]\nExecStart=\nExecStart={studio}/.venv/bin/python -I -m uvicorn --app-dir {entry} vm_studio:create_test_app --factory --host 127.0.0.1 --port 8090 --workers 1 --no-access-log\n',
    'bc250-llm-gate.service.d/zz-bc250-installed-test.conf': f'[Service]\nExecStart=\nExecStart={worker}/.venv/bin/python -I -m uvicorn app.gate:create_gate_app --factory --host 127.0.0.1 --port 8081 --workers 1 --no-access-log\n',
    'bc250-model-worker.service.d/zz-bc250-installed-test.conf': f'[Service]\nExecStart=\nExecStart={worker}/.venv/bin/python -I -m app.services.model_control_runtime\n',
    'bc250-model-api.service.d/zz-bc250-installed-test.conf': f'[Service]\nExecStart=\nExecStart={worker}/.venv/bin/python -I -m uvicorn app.services.model_management_server:create_app --factory --host 127.0.0.1 --port 8091 --workers 1 --no-access-log\n',
    'bc250-llm-client.service': '[Unit]\nDescription=Disposable client process for staged startup test\n[Service]\nType=simple\nUser=vmtest\nGroup=vmtest\nEnvironmentFile=/etc/bc250-model-control/client-gate.env\nExecStart=/usr/bin/sleep 600\nKillMode=control-group\n',
}
for name, content in expected.items():
    path = unitdir / name
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != 0 or path.read_text() != content:
        raise SystemExit('시험 unit이 예상과 다릅니다. 상태를 보존합니다.')
old = set(json.loads((evidence / 'holds.json').read_text())['holds'])
now = set(json.loads(Path('/var/lib/bc250-llm-gate/holds.json').read_text())['holds'])
if not (old - {'startup'}).issubset(now):
    raise SystemExit('시험 보류 상태가 예상과 다릅니다. 상태를 보존합니다.')
PY
record=$(mktemp -d "$evidence/cleanup.XXXXXXXX")
trap 'echo "시험 정리 중단. 상태와 기록을 보존합니다: $record" >&2' ERR
cp -a /var/lib/bc250-llm-gate/holds.json "$record/holds-before-cleanup.json"
for unit in bc250-ai-studio.service bc250-llm-gate.service bc250-model-worker.service bc250-model-api.service; do
  cp -a "/run/systemd/system/$unit.d/zz-bc250-installed-test.conf" "$record/$unit.conf"
done
cp -a /run/systemd/system/bc250-llm-client.service "$record/client.service"
systemctl stop bc250-model-api.service bc250-model-worker.socket bc250-model-worker.service \
  bc250-llm-client.service bc250-ai-studio.service bc250-llm-gate.service llama-server.service
systemctl start bc250-llm-gate.service
python3 - "$evidence/holds.json" <<'PY'
import json
import sys
import time
from pathlib import Path
old = set(json.loads(Path(sys.argv[1]).read_text())['holds'])
for _ in range(60):
    try:
        current = set(json.loads(Path('/var/lib/bc250-llm-gate/holds.json').read_text())['holds'])
        if 'startup' in current and old.issubset(current):
            break
    except (OSError, ValueError, KeyError):
        pass
    time.sleep(1)
else:
    raise SystemExit('기존 보류와 startup 보류를 확인하지 못했습니다.')
print('시험 전 보류와 startup 보류 복원 확인', flush=True)
PY
systemctl stop bc250-llm-gate.service
for unit in bc250-ai-studio.service bc250-llm-gate.service bc250-model-worker.service bc250-model-api.service bc250-llm-client.service llama-server.service; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == inactive \
    && $(systemctl show "$unit" -p MainPID --value) == 0 \
    && -z $(systemctl show "$unit" -p Job --value) ]] || { echo "시험 서비스 정지 확인 실패: $unit" >&2; exit 1; }
done
[[ $(systemctl show bc250-model-worker.socket -p ActiveState --value) == inactive ]] || exit 1
for unit in bc250-ai-studio.service bc250-llm-gate.service bc250-model-worker.service bc250-model-api.service; do
  rm -- "/run/systemd/system/$unit.d/zz-bc250-installed-test.conf"
done
rm -- /run/systemd/system/bc250-llm-client.service
systemctl daemon-reload
echo "시험 서비스 정지 및 임시 unit 정리 완료. 기록 보관: $record"
