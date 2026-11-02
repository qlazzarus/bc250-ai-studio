#!/usr/bin/env bash
# Exercise the actual credential checker against isolated VM systemd services.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test ]] || {
  echo '시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 QEMU 시험 VM이 아닙니다.' >&2; exit 1;
}
[[ $# == 1 && -f "$1/backend/app/services/client_gate_check.py" \
  && -f "$1/deploy/model-control/llm-client.conf" ]] || {
  echo '시험 소스가 필요합니다.' >&2; exit 1;
}
source_dir=$1
candidate=/opt/bc250-client-gate-check-candidate
fixture=/etc/bc250-client-gate-check-test
unit=/run/systemd/system/bc250-llm-client.service
dropin=/run/systemd/system/bc250-llm-client.service.d
client_env=/etc/bc250-model-control/client-gate.env
for path in "$candidate" "$fixture" "$unit" "$dropin" "$client_env" \
  /etc/systemd/system/bc250-llm-client.service; do
  [[ ! -e "$path" && ! -L "$path" ]] || { echo "이미 존재합니다: $path" >&2; exit 1; }
done
[[ -z $(find "$source_dir/backend" -type l -print -quit) ]] || {
  echo '시험 소스에 심볼릭 링크가 있습니다.' >&2; exit 1;
}
! systemctl is-active --quiet bc250-llm-gate.service || {
  echo '시험 gate가 이미 실행 중입니다.' >&2; exit 1;
}
install -d -o root -g root -m 0755 "$candidate"
cp -R --no-preserve=ownership "$source_dir/backend" "$candidate/backend"
chmod -R go-w "$candidate/backend"
install -d -o root -g root -m 0700 "$fixture"
printf 'LLM_GATE_API_KEY=old-test-key-not-for-real-services\n' > "$fixture/legacy.env"
chmod 0600 "$fixture/legacy.env"
python3 - "$client_env" <<'PY'
import os
import sys
from pathlib import Path
key = Path('/etc/bc250-model-control/gate-admin-key').read_text().strip()
assert len(key) >= 24
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, 'w') as file:
    file.write('LLM_GATE_API_KEY=' + key + '\n')
    file.flush()
    os.fsync(file.fileno())
PY
cat > "$unit" <<'EOF'
[Unit]
Description=Disposable LLM Client for gate credential check
[Service]
Type=simple
User=vmtest
Group=vmtest
EnvironmentFile=/etc/bc250-client-gate-check-test/legacy.env
ExecStart=/usr/bin/python3 -c 'import time; time.sleep(600)'
KillMode=control-group
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
EOF
chmod 0644 "$unit"
restorecon -RF "$candidate" "$fixture" "$client_env" "$unit"
systemctl daemon-reload
systemctl start bc250-llm-gate.service bc250-llm-client.service

python3 - <<'PY'
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
key = Path('/etc/bc250-model-control/gate-admin-key').read_text().strip()
request = urllib.request.Request('http://127.0.0.1:8081/control/identity',
                                 headers={'Authorization': 'Bearer ' + key})
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for attempt in range(24):
    try:
        with opener.open(request, timeout=10) as response:
            identity = json.load(response)
        if identity == {'role': 'admin', 'protocol': 2}:
            break
    except urllib.error.HTTPError as error:
        raise SystemExit(f'시험 gate 인증 오류: {error.code}') from None
    except OSError:
        pass
    print(f'시험 gate 시작 대기 {attempt + 1}/24')
    time.sleep(5)
else:
    raise SystemExit('시험 gate 시작을 확인하지 못했습니다.')
print('시험 gate의 관리자 역할 확인')
PY

checker=(/opt/bc250-model-control/.venv/bin/python -I -c
  "import sys; sys.path.insert(0, '$candidate/backend'); from app.services.client_gate_check import main; main()"
  --expected-user vmtest)
if "${checker[@]}" >/dev/null 2>&1; then
  echo '일치하지 않는 클라이언트 키가 잘못 승인됐습니다.' >&2
  exit 1
fi
echo '기존 시험 키 불일치 거절 확인'

install -d -o root -g root -m 0755 "$dropin"
install -o root -g root -m 0644 "$source_dir/deploy/model-control/llm-client.conf" "$dropin/llm-client.conf"
restorecon -RF "$dropin"
systemctl daemon-reload
systemctl restart bc250-llm-client.service
"${checker[@]}"
echo '실제 systemd 프로세스 환경과 gate 관리자 역할 일치 확인'
