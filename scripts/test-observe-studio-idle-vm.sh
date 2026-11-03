#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-studio-observe.XXXXXXXX)
chmod 0755 "$fixture"
unit=/run/systemd/system/bc250-studio-observe-fixture.service
[[ ! -e $unit && ! -L $unit && ! -e /etc/systemd/system/${unit##*/} \
  && $(systemctl show "${unit##*/}" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $fixture $unit" >&2' ERR
install -o root -g root -m 0644 "$source_dir/deploy/model-control/observe-studio-idle.py" "$fixture/observe.py"
cat > "$fixture/studio.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
import sys

fixture = Path(sys.argv[1])
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get('Authorization') != 'Bearer ' + 'x' * 24:
            self.send_error(401)
            return
        if self.path == '/api/v1/system/status':
            data = {'recovery_required': (fixture / 'recovery').exists(), 'scheduler_running': True,
                    'gpu_owner': None, 'active_job': None, 'transition': {}, 'llm_recovery': {}}
        elif self.path == '/api/v1/jobs?limit=200&offset=0':
            data = [{'status': 'queued' if (fixture / 'queued').exists() else 'completed'}]
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    def log_message(self, *_):
        pass
HTTPServer(('127.0.0.1', 18909), Handler).serve_forever()
PY
chmod 0644 "$fixture/studio.py"
cat > "$unit" <<EOF
[Service]
ExecStart=/usr/bin/python3 $fixture/studio.py $fixture
KillMode=control-group
EOF
restorecon -RF "$fixture"
restorecon -F "$unit"
systemctl daemon-reload
systemctl start "${unit##*/}"
python3 - "$fixture" <<'PY'
import importlib.util
import sys
import time
import urllib.error
from pathlib import Path

fixture = Path(sys.argv[1])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fixture_studio', fixture / 'observe.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.UNIT = 'bc250-studio-observe-fixture.service'
module.BASE = 'http://127.0.0.1:18909/api/v1'
for attempt in range(30):
    try:
        if module.observe('x' * 24):
            break
    except urllib.error.URLError:
        if attempt == 29:
            raise
        time.sleep(0.2)
else:
    raise SystemExit('시험 Studio 응답을 확인하지 못했습니다.')
print('시험 Studio의 인증·유휴 상태와 완료 작업 확인', flush=True)
for name in ('queued', 'recovery'):
    marker = fixture / name
    marker.touch()
    try:
        module.observe('x' * 24)
    except ValueError:
        pass
    else:
        raise SystemExit('시험 대기 작업 또는 복구 상태가 허용됐습니다.')
    marker.unlink()
print('시험 대기 작업과 복구 필요 상태 거절 확인', flush=True)
try:
    module.observe('y' * 24)
except urllib.error.HTTPError as exc:
    if exc.code != 401:
        raise
else:
    raise SystemExit('잘못된 시험 인증이 허용됐습니다.')
print('잘못된 시험 Studio 인증 거절 확인', flush=True)
print('이 관찰은 이후 작업 제출 차단이나 전체 유휴 상태를 보증하지 않습니다.', flush=True)
PY
systemctl stop "${unit##*/}"
rm -- "$unit"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture"
