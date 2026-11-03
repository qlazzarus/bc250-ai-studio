#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing \
  && ( $# == 1 || ( $# == 2 && $2 == composite ) ) ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-direct-observe.XXXXXXXX)
chmod 0755 "$fixture"
wiki=/run/systemd/system/bc250-direct-wiki-fixture.service
llama=/run/systemd/system/bc250-direct-llama-fixture.service
for unit in "$wiki" "$llama"; do
  [[ ! -e $unit && ! -L $unit && ! -e /etc/systemd/system/${unit##*/} \
    && $(systemctl show "${unit##*/}" -p LoadState --value) == not-found ]] || exit 1
done
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $fixture $wiki $llama" >&2' ERR
for name in observe-direct-llm.py local-idle-composite.py backup-archive.sh check-service-cgroup.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$fixture/$name"
done
cat > "$fixture/llama.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import sys

busy = Path(sys.argv[1]) / 'busy'
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/slots':
            self.send_error(404)
            return
        data = b'[{"is_processing":true}]' if busy.exists() else b'[{"is_processing":false}]'
        self.send_response(200)
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *_):
        pass
HTTPServer(('127.0.0.1', 18881), Handler).serve_forever()
PY
chmod 0644 "$fixture/llama.py"
cat > "$wiki" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
cat > "$llama" <<EOF
[Service]
ExecStart=/usr/bin/python3 $fixture/llama.py $fixture
KillMode=control-group
EOF
restorecon -RF "$fixture"
restorecon -F "$wiki" "$llama"
systemctl daemon-reload
systemctl start "${wiki##*/}" "${llama##*/}"
python3 - "$fixture" "${2:-observe}" <<'PY'
import importlib.util
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

fixture = Path(sys.argv[1])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fixture_direct', fixture / 'observe-direct-llm.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.WIKI = 'bc250-direct-wiki-fixture.service'
module.LLAMA = 'bc250-direct-llama-fixture.service'
module.SLOTS_URL = 'http://127.0.0.1:18881/slots'
guard = fixture / 'backup-archive.sh'
try:
    module.observe(guard)
except subprocess.CalledProcessError:
    print('실행 중인 시험 Wiki의 직접 호출 차단 확인 실패', flush=True)
else:
    raise SystemExit('실행 중인 시험 Wiki가 허용됐습니다.')
subprocess.run(['/usr/bin/systemctl', 'stop', module.WIKI], check=True)
for attempt in range(30):
    try:
        if module.observe(guard) is True:
            break
    except urllib.error.URLError:
        if attempt == 29:
            raise
        time.sleep(0.2)
else:
    raise SystemExit('시험 llama 준비를 확인하지 못했습니다.')
print('정지된 시험 Wiki cgroup과 유휴 시험 llama 슬롯 확인', flush=True)
(fixture / 'busy').touch()
try:
    module.observe(guard)
except ValueError as exc:
    if '진행 중인 llama 슬롯' not in str(exc):
        raise
else:
    raise SystemExit('사용 중인 시험 llama 슬롯이 허용됐습니다.')
print('사용 중인 시험 llama 슬롯 거절 확인', flush=True)
if sys.argv[2] == 'composite':
    (fixture / 'busy').unlink()
    spec = importlib.util.spec_from_file_location('fixture_composite', fixture / 'local-idle-composite.py')
    composite = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(composite)
    blocked = [False]
    runner = composite.LocalIdleComposite(check_wiki_fence=lambda: True,
        check_other_callers_fenced=lambda: blocked[0], observe_llama=lambda: module.observe(guard),
        check_gpu_idle=lambda: True)
    try:
        runner()
    except ValueError:
        print('모의 직접 호출 차단이 없으면 시험 유휴 검사 거절 확인', flush=True)
    else:
        raise SystemExit('차단 없는 시험이 허용됐습니다.')
    blocked[0] = True
    if runner() is not True:
        raise SystemExit('시험 유휴 검사가 완료되지 않았습니다.')
    (fixture / 'busy').touch()
    try:
        runner()
    except ValueError:
        print('시험 llama 슬롯 사용 중 결합 검사 거절 확인', flush=True)
    else:
        raise SystemExit('사용 중인 시험 llama가 허용됐습니다.')
    print('시험 Wiki cgroup·llama 관찰과 결합 검사 확인; 영구 차단·GPU 검사는 모의', flush=True)
print('이 관찰은 다른 직접 호출의 지속 차단이나 전체 유휴 상태를 보증하지 않습니다.', flush=True)
PY
systemctl stop "${wiki##*/}" "${llama##*/}"
rm -- "$wiki" "$llama"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture"
