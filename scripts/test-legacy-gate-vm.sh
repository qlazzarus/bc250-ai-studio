#!/usr/bin/env bash
# Destructive only inside the dedicated disposable VM; never run on the host.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test ]] || {
  echo '시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $(systemd-detect-virt) == qemu ]] || {
  echo 'QEMU 시험 VM이 아니므로 중단합니다.' >&2; exit 1;
}
[[ $# == 1 && -f "$1/deploy/model-control/migrate-legacy-gate.py" ]] || {
  echo '시험 소스 경로가 필요합니다.' >&2; exit 1;
}
source_dir=$1
snapshot=/var/lib/bc250-model-control/legacy-pause.json
gate_dir=/var/lib/bc250-llm-gate
legacy_env=/etc/bc250-gate-legacy-test.env
legacy_dropin=/etc/systemd/system/bc250-llm-gate.service.d/zz-legacy-test.conf
studio_unit=/etc/systemd/system/bc250-ai-studio.service
for item in "$snapshot" "$legacy_env" "$legacy_dropin" "$studio_unit"; do
  [[ ! -e "$item" && ! -L "$item" ]] || { echo "이미 존재합니다: $item" >&2; exit 1; }
done
[[ -d "$gate_dir" && -f "$gate_dir/holds.json" ]] || {
  echo '기존 시험 gate 상태를 찾을 수 없습니다.' >&2; exit 1;
}
systemctl is-active --quiet bc250-llm-gate.service
umask 077
backup=$(mktemp -d /var/lib/bc250-model-control/migration-test-backup.XXXXXXXX)
echo "기존 시험 상태 보관 경로: $backup"
systemctl stop bc250-llm-gate.service

# A disposable legacy-compatible gate uses its own test-only key.
python3 - "$legacy_env" <<'PY'
import os
import secrets
import sys
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    output.write('GATE_API_KEY=' + secrets.token_hex(32) + '\n')
PY
cat > "$legacy_dropin" <<'EOF'
[Service]
EnvironmentFile=
EnvironmentFile=/etc/bc250-gate-legacy-test.env
EOF
cat > "$studio_unit" <<'EOF'
[Unit]
Description=Disposable Studio placeholder for migration test
[Service]
Type=oneshot
ExecStart=/usr/bin/true
KillMode=control-group
EOF
restorecon -F "$legacy_env" "$legacy_dropin" "$studio_unit"
systemctl daemon-reload
systemctl start bc250-llm-gate.service

python3 - "$legacy_env" <<'PY'
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
key = Path(sys.argv[1]).read_text().strip().partition('=')[2]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for attempt in range(24):
    try:
        request = urllib.request.Request('http://127.0.0.1:8081/control',
                                         headers={'Authorization': 'Bearer ' + key})
        with opener.open(request, timeout=10) as response:
            state = json.load(response)
        break
    except urllib.error.HTTPError as error:
        raise SystemExit(f'레거시 시험 gate 응답 오류: {error.code}') from None
    except OSError:
        time.sleep(5)
else:
    raise SystemExit('레거시 호환 시험 gate가 시작되지 않았습니다.')
assert state['paused'] is False and 'protocol' not in state
request = urllib.request.Request('http://127.0.0.1:8081/control',
    data=b'{"paused":true}', method='PUT',
    headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
with opener.open(request, timeout=10) as response:
    assert json.load(response)['paused'] is True
print('기존 관리자 pause가 있는 레거시 호환 gate 준비 완료')
PY

# The migration tool reads this legacy key file. The original empty VM fixture
# is saved rather than overwritten without a backup.
cp -p /etc/bc250-llm-gate.env "$backup/original-gate.env"
cp -p "$legacy_env" /etc/bc250-llm-gate.env
python3 "$source_dir/deploy/model-control/migrate-legacy-gate.py" capture
systemctl stop bc250-llm-gate.service
mv -T "$gate_dir" "$backup/gate-state"
python3 "$source_dir/deploy/model-control/migrate-legacy-gate.py" create-state
mv "$legacy_dropin" "$backup/legacy-test.conf"
cp -p "$backup/original-gate.env" /etc/bc250-llm-gate.env
restorecon -RF "$gate_dir" /etc/bc250-llm-gate.env
systemctl daemon-reload
systemctl start bc250-llm-gate.service

python3 - <<'PY'
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
key = Path('/etc/bc250-model-control/gate-admin-key').read_text().strip()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for attempt in range(24):
    try:
        request = urllib.request.Request('http://127.0.0.1:8081/control',
                                         headers={'Authorization': 'Bearer ' + key})
        with opener.open(request, timeout=10) as response:
            state = json.load(response)
        break
    except urllib.error.HTTPError as error:
        raise SystemExit(f'소유권 gate 응답 오류: {error.code}') from None
    except OSError:
        time.sleep(5)
else:
    raise SystemExit('소유권 gate가 다시 시작되지 않았습니다.')
assert state['paused'] and {'startup', 'legacy'}.issubset(state['holds']), state
print('이전 관리자 pause와 새 startup 보류가 함께 유지됨을 확인했습니다.')
PY
echo "시험 완료. 백업과 시험 기록은 보존했습니다: $backup"
