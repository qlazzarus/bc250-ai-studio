#!/usr/bin/env bash
# Test systemd credential override in the disposable VM; never use real secrets.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test ]] || {
  echo '시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 QEMU 시험 VM이 아닙니다.' >&2; exit 1;
}
[[ $# == 1 && -f "$1/deploy/model-control/prepare-secrets.py" \
  && -f "$1/deploy/model-control/llm-client.conf" ]] || {
  echo '시험 소스가 필요합니다.' >&2; exit 1;
}
source_dir=$1
config=/etc/bc250-credential-test
unit=/run/systemd/system/bc250-client-key-test.service
dropin=/run/systemd/system/bc250-client-key-test.service.d
client_probe=/opt/bc250-client-key-probe.py
for path in "$config" "$unit" "$dropin" "$client_probe"; do
  [[ ! -e "$path" && ! -L "$path" ]] || { echo "이미 존재합니다: $path" >&2; exit 1; }
done
trap 'systemctl stop bc250-client-key-test.service >/dev/null 2>&1 || true' EXIT

python3 - "$source_dir/deploy/model-control/prepare-secrets.py" <<'PY'
import importlib.util
import sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('prepare_secrets_test', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.DIRECTORY = Path('/etc/bc250-credential-test')
module.main()
PY
printf 'LLM_GATE_API_KEY=old-test-key-not-used-for-real-services\n' > "$config/legacy.env"
chmod 0600 "$config/legacy.env"
cat > "$client_probe" <<'PY'
import hashlib
import hmac
import os

value = os.environ.get('LLM_GATE_API_KEY', '')
actual = hashlib.sha256(value.encode()).hexdigest()
assert hmac.compare_digest(actual, os.environ['EXPECTED_TEST_HASH'])
print('systemd 클라이언트 프로세스의 새 gate 관리 키 적용 확인')
PY
chmod 0644 "$client_probe"
expected_hash=$(python3 - <<'PY'
import hashlib
from pathlib import Path
value = Path('/etc/bc250-credential-test/gate-admin-key').read_bytes().strip()
print(hashlib.sha256(value).hexdigest())
PY
)
cat > "$unit" <<'EOF'
[Unit]
Description=Disposable client credential override test
[Service]
Type=oneshot
User=vmtest
Group=vmtest
EnvironmentFile=/etc/bc250-credential-test/legacy.env
ExecStart=/usr/bin/python3 -I /opt/bc250-client-key-probe.py
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
EOF
printf 'Environment=EXPECTED_TEST_HASH=%s\n' "$expected_hash" >> "$unit"
install -d -o root -g root -m 0755 "$dropin"
sed 's@/etc/bc250-model-control/client-gate.env@/etc/bc250-credential-test/client-gate.env@' \
  "$source_dir/deploy/model-control/llm-client.conf" > "$dropin/llm-client.conf"
chmod 0644 "$unit" "$dropin/llm-client.conf"
restorecon -RF "$config" "$unit" "$dropin" "$client_probe"
systemctl daemon-reload
if ! systemctl start bc250-client-key-test.service; then
  journalctl -b -u bc250-client-key-test.service -n 20 --no-pager -o cat
  exit 1
fi
journalctl -b -u bc250-client-key-test.service -n 20 --no-pager -o cat

if sudo -u vmtest test -r "$config/client-gate.env"; then
  echo '클라이언트 계정이 root 전용 파일을 직접 읽을 수 있습니다.' >&2
  exit 1
fi
echo '클라이언트 계정의 root 전용 키 파일 직접 읽기 차단 확인'

probe=/opt/bc250-client-credential-probe.py
[[ ! -e "$probe" && ! -L "$probe" ]] || { echo '시험 파일이 이미 있습니다.' >&2; exit 1; }
cat > "$probe" <<'PY'
from pathlib import Path
path = Path('/etc/bc250-credential-test/client-gate.env')
try:
    value = path.read_bytes()
except OSError:
    print('작업자 제한 환경에서 클라이언트 키 파일 접근 차단 확인')
else:
    if value:
        raise SystemExit('제한 환경에서 클라이언트 키 파일을 읽을 수 있습니다.')
    print('작업자 제한 환경에서 클라이언트 키 파일 차단 확인')
PY
chmod 0644 "$probe"
restorecon -F "$probe"
result=0
systemd-run --wait --collect --unit=bc250-worker-key-isolation-test \
  -p User=root -p Group=root -p NoNewPrivileges=yes -p ProtectSystem=strict \
  -p "InaccessiblePaths=$config/client-gate.env" -p CapabilityBoundingSet=CAP_CHOWN \
  /usr/bin/python3 -I "$probe" || result=$?
journalctl -b -u bc250-worker-key-isolation-test -n 20 --no-pager -o cat
(( result == 0 )) || exit "$result"
echo '시험 전용 키 전달과 격리 확인 완료'
