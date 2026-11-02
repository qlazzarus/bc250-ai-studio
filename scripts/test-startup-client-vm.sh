#!/usr/bin/env bash
# Verify the current startup-release candidate with real VM systemd processes.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test ]] || {
  echo '시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 QEMU 시험 VM이 아닙니다.' >&2; exit 1;
}
[[ $# == 1 && -f "$1/backend/app/services/client_gate_check.py" \
  && -f "$1/deploy/model-control/llm-client.conf" \
  && -f "$1/systemd/bc250-gpu-lock.conf" ]] || {
  echo '시험 소스가 필요합니다.' >&2; exit 1;
}
source_dir=$1
candidate=/opt/bc250-startup-client-candidate
fixture=/etc/bc250-startup-client-fixture
unit=/run/systemd/system/bc250-llm-client.service
dropin=/run/systemd/system/bc250-llm-client.service.d
for path in "$candidate" "$fixture" "$unit" "$dropin" \
  /etc/systemd/system/bc250-llm-client.service; do
  [[ ! -e "$path" && ! -L "$path" ]] || { echo "이미 존재합니다: $path" >&2; exit 1; }
done
[[ -z $(find "$source_dir/backend" -type l -print -quit) ]] || {
  echo '시험 소스에 심볼릭 링크가 있습니다.' >&2; exit 1;
}
for unit_name in bc250-llm-gate.service bc250-ai-studio.service llama-server.service \
  bc250-model-worker.socket bc250-llm-client.service; do
  if systemctl is-active --quiet "$unit_name"; then
    echo "시험 서비스가 이미 실행 중입니다: $unit_name" >&2; exit 1
  fi
done
python3 - <<'PY'
import hmac
from pathlib import Path
directory = Path('/etc/bc250-model-control')
key = (directory / 'gate-admin-key').read_text().strip()
client = (directory / 'client-gate.env').read_text().strip().partition('=')[2]
assert len(key) >= 24 and hmac.compare_digest(key, client)
print('기존 시험 gate와 클라이언트 환경 파일의 키 일치 확인')
PY
install -d -o root -g root -m 0755 "$candidate"
cp -R --no-preserve=ownership "$source_dir/backend" "$candidate/backend"
chmod -R go-w "$candidate/backend"
install -d -o root -g root -m 0700 "$fixture"
printf 'LLM_GATE_API_KEY=old-startup-test-key-not-for-real-services\n' > "$fixture/legacy.env"
chmod 0600 "$fixture/legacy.env"
cat > "$unit" <<'EOF'
[Unit]
Description=Disposable LLM Client for startup confirmation test
[Service]
Type=simple
User=vmtest
Group=vmtest
EnvironmentFile=/etc/bc250-startup-client-fixture/legacy.env
ExecStart=/usr/bin/python3 -c 'import time; time.sleep(600)'
KillMode=control-group
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
EOF
chmod 0644 "$unit"
restorecon -RF "$candidate" "$fixture" "$unit"
if [[ ! -e /run/bc250-gpu ]]; then
  systemd-tmpfiles --create "$source_dir/systemd/bc250-gpu-lock.conf"
fi
systemctl daemon-reload
systemctl start bc250-llm-gate.service llama-server.service bc250-model-worker.socket \
  bc250-ai-studio.service bc250-llm-client.service

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
}
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
targets = (
    ('http://127.0.0.1:8081/control', keys['gate']),
    ('http://127.0.0.1:8090/internal/model-switch/coordination', keys['studio']),
)
for url, key in targets:
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key})
    for attempt in range(24):
        try:
            with opener.open(request, timeout=10) as response:
                data = json.load(response)
            if url.endswith('/control'):
                assert data['paused'] and {'startup', 'legacy'}.issubset(data['holds'])
            elif data != {'protocol': 1, 'enabled': True, 'transition_clear': True}:
                raise ValueError('조율 준비 전')
            break
        except urllib.error.HTTPError as error:
            raise SystemExit(f'시험 서비스 인증 오류: {error.code}') from None
        except (OSError, ValueError):
            print(f'시험 서비스 준비 대기 {attempt + 1}/24', flush=True)
            time.sleep(5)
    else:
        raise SystemExit('시험 서비스 준비를 확인하지 못했습니다.')
print('시험 gate 보류와 Studio 조율 확인')
PY

/opt/bc250-model-control/.venv/bin/python -I - <<'PY'
import asyncio
from app.services.model_control_bridge import ModelControlClient

async def main():
    client = ModelControlClient('/run/bc250-model-control/control.sock')
    for attempt in range(12):
        try:
            result = await client.request('pending')
            if result == {'operation': None}:
                print('시험 작업자에 미완료 작업이 없음 확인')
                return
            if result.get('operation') is not None:
                raise RuntimeError('미완료 작업이 있습니다.')
        except (OSError, TimeoutError):
            pass
        print(f'시험 작업자 준비 대기 {attempt + 1}/12', flush=True)
        await asyncio.sleep(5)
    raise SystemExit('시험 작업자의 준비 상태를 확인하지 못했습니다.')

asyncio.run(main())
PY

python=/opt/bc250-model-control/.venv/bin/python
confirm=("$python" -I -c
  "import sys; sys.path.insert(0, '$candidate/backend'); from app.services.gate_admin import main; main()"
  confirm-startup --expected-client-user vmtest)
checker=("$python" -I -c
  "import sys; sys.path.insert(0, '$candidate/backend'); from app.services.client_gate_check import main; main()"
  --expected-user vmtest)

if "${confirm[@]}" >/dev/null 2>&1; then
  echo '일치하지 않는 클라이언트 키로 시작 보류가 해제됐습니다.' >&2
  exit 1
fi
python3 - <<'PY'
import json
import urllib.request
from pathlib import Path
key = Path('/etc/bc250-model-control/gate-admin-key').read_text().strip()
request = urllib.request.Request('http://127.0.0.1:8081/control',
                                 headers={'Authorization': 'Bearer ' + key})
with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=10) as response:
    state = json.load(response)
assert state['paused'] and {'startup', 'legacy'}.issubset(state['holds'])
print('클라이언트 키 불일치 시 시작 보류 유지 확인')
PY

install -d -o root -g root -m 0755 "$dropin"
install -o root -g root -m 0644 "$source_dir/deploy/model-control/llm-client.conf" "$dropin/llm-client.conf"
restorecon -RF "$dropin"
systemctl daemon-reload
systemctl restart bc250-llm-client.service
"${checker[@]}"
"${confirm[@]}"
python3 - <<'PY'
import json
import urllib.request
from pathlib import Path
key = Path('/etc/bc250-model-control/gate-admin-key').read_text().strip()
request = urllib.request.Request('http://127.0.0.1:8081/control',
                                 headers={'Authorization': 'Bearer ' + key})
with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=10) as response:
    state = json.load(response)
assert state['paused'] and 'legacy' in state['holds'] and 'startup' not in state['holds']
print('클라이언트 검증 후 startup만 해제하고 legacy 보류 유지 확인')
PY
