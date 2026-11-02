#!/usr/bin/env bash
# Runs only in the disposable QEMU VM. Never use on a real Studio host.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test ]] || {
  echo '시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $(systemd-detect-virt) == qemu ]] || { echo 'QEMU 시험 VM이 아닙니다.' >&2; exit 1; }
[[ $# == 1 && -f "$1/config/models.yaml" ]] || { echo '시험 소스가 필요합니다.' >&2; exit 1; }
source_dir=$1
fixture=/opt/bc250-model-control/test-fixture
data=/opt/bc250-studio-test-data
studio_unit=/etc/systemd/system/bc250-ai-studio.service
llm_unit=/etc/systemd/system/llama-server.service
test_env=/etc/bc250-model-control/studio-test.env
for item in "$fixture" "$data" "$llm_unit" "$test_env" \
  /opt/bc250-model-control/config /opt/bc250-model-control/backend/vm_studio.py \
  /etc/systemd/system/bc250-ai-studio.service.placeholder; do
  [[ ! -e "$item" && ! -L "$item" ]] || { echo "이미 존재합니다: $item" >&2; exit 1; }
done
[[ -f "$studio_unit" ]] || { echo '시험용 Studio placeholder가 없습니다.' >&2; exit 1; }
! systemctl is-active --quiet bc250-ai-studio.service || {
  echo '시험 Studio가 이미 실행 중입니다.' >&2; exit 1;
}
for port in 8080 8090; do
  [[ -z $(ss -H -ltn "sport = :$port") ]] || { echo "포트 사용 중: $port" >&2; exit 1; }
done
umask 077
install -d -o root -g root -m 0755 "$fixture" /opt/bc250-model-control/config
install -d -o ai-studio -g ai-studio -m 0700 "$data"
install -o root -g root -m 0644 "$source_dir/config/models.yaml" /opt/bc250-model-control/config/models.yaml

cat > "$fixture/mock_llm.py" <<'PY'
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = {'/slots': [{'is_processing': False}], '/health': {'status': 'ok'},
                '/v1/models': {'data': [{'id': '/opt/ai/models/fake.gguf'}]}}.get(self.path)
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
cat > /opt/bc250-model-control/backend/vm_studio.py <<'PY'
from app.core.config import Settings
from app.main import create_app
from app.services.llm import SystemdLLM

def create_test_app():
    settings = Settings()
    return create_app(settings, llm=SystemdLLM(settings))
PY
chmod 0644 "$fixture/mock_llm.py" /opt/bc250-model-control/backend/vm_studio.py
python3 - "$test_env" <<'PY'
import os
import secrets
import sys
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    output.write('STUDIO_API_KEY=' + secrets.token_hex(32) + '\n')
    output.write('STUDIO_ADMIN_KEY=' + secrets.token_hex(32) + '\n')
    output.write('STUDIO_DATA_DIR=/opt/bc250-studio-test-data\n')
    output.write('STUDIO_REGISTRY_PATH=/opt/bc250-model-control/config/models.yaml\n')
    output.write('STUDIO_ENGINE=fake\nSTUDIO_POLICY=manual\n')
    output.write('STUDIO_LLM_SERVICE=llama-server.service\n')
    output.write('STUDIO_ALLOWED_SERVICES=\'["llama-server.service"]\'\n')
PY
cat > "$llm_unit" <<'EOF'
[Unit]
Description=Disposable mock LLM for model-control VM test
[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/bc250-model-control/test-fixture/mock_llm.py
KillMode=control-group
EOF
mv "$studio_unit" "$studio_unit.placeholder"
cat > "$studio_unit" <<'EOF'
[Unit]
Description=Disposable Studio for model-control VM test
[Service]
Type=simple
User=ai-studio
Group=ai-studio
WorkingDirectory=/opt/bc250-model-control
EnvironmentFile=/etc/bc250-model-control/studio-test.env
EnvironmentFile=/etc/bc250-model-control/studio-gate.env
ExecStart=/opt/bc250-model-control/.venv/bin/python -I -m uvicorn --app-dir /opt/bc250-model-control/backend vm_studio:create_test_app --factory --host 127.0.0.1 --port 8090 --workers 1 --no-access-log
KillMode=control-group
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/opt/bc250-studio-test-data /run/bc250-gpu
EOF
chmod 0644 "$llm_unit" "$studio_unit"
restorecon -RF "$fixture" "$data" /opt/bc250-model-control/config /opt/bc250-model-control/backend/vm_studio.py "$test_env" "$llm_unit" "$studio_unit"
systemctl daemon-reload
systemctl start llama-server.service bc250-ai-studio.service

python3 - <<'PY'
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
key = Path('/etc/bc250-model-control/studio-coordination-key').read_text().strip()
request = urllib.request.Request('http://127.0.0.1:8090/internal/model-switch/coordination',
                                 headers={'Authorization': 'Bearer ' + key})
for attempt in range(24):
    try:
        with opener.open(request, timeout=10) as response:
            result = json.load(response)
        if result == {'protocol': 1, 'enabled': True, 'transition_clear': True}:
            break
    except urllib.error.HTTPError as error:
        raise SystemExit(f'시험 Studio 인증 오류: {error.code}') from None
    except OSError:
        pass
    print(f'시험 Studio 조율 준비 대기 {attempt + 1}/24')
    time.sleep(5)
else:
    raise SystemExit('시험 Studio 조율을 확인하지 못했습니다.')
print('시험 Studio의 실제 조율 응답 확인')
PY

# This CLI performs the actual production checks, against only VM fixtures.
/opt/bc250-model-control/.venv/bin/python -I -m app.services.gate_admin confirm-startup
python3 - <<'PY'
import json
import urllib.request
from pathlib import Path
key = Path('/etc/bc250-model-control/gate-admin-key').read_text().strip()
request = urllib.request.Request('http://127.0.0.1:8081/control',
                                 headers={'Authorization': 'Bearer ' + key})
with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=10) as response:
    state = json.load(response)
assert state['paused'] and 'legacy' in state['holds'] and 'startup' not in state['holds'], state
print('정상 확인 후 startup만 해제되고 기존 legacy 보류가 유지됨을 확인')
PY
