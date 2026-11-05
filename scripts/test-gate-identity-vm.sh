#!/usr/bin/env bash
# Test disposable systemd services only; the real gate is not started.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 \
  && -f $1/backend/app/services/gate_process_identity.py ]] || exit 1
records=$(mktemp -d /var/backups/bc250-gate-identity.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
good="bc250-identity-good-$suffix.service"
bad="bc250-identity-bad-$suffix.service"
for unit in "$good" "$bad"; do
  [[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
done
trap 'echo "시험 중단. 시험 unit과 기록 보존: $good $bad $records" >&2' ERR
systemd-run --quiet --unit="$good" --property=Type=exec --property=User=ai-gate \
  --property=Group=ai-gate --property=NoNewPrivileges=yes /usr/bin/sleep infinity
systemd-run --quiet --unit="$bad" --property=Type=exec --property=User=ai-gate \
  --property=Group=ai-gate --property=NoNewPrivileges=no /usr/bin/sleep infinity
python3 - "$1/backend/app/services/gate_process_identity.py" "$good" "$bad" <<'PY'
import importlib.util
import sys
import time

spec = importlib.util.spec_from_file_location('identity', sys.argv[1])
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)
for _ in range(60):
    try:
        identity.observe(sys.argv[2], client_user='vmtest')
        break
    except (OSError, ValueError):
        time.sleep(.5)
else:
    raise SystemExit('시험 계정 서비스 준비 또는 권한 확인 시간 초과')
print('시험 gate·Studio·Client UID 분리와 프로세스 권한 확인', flush=True)
try:
    identity.observe(sys.argv[2], client_user='ai-gate')
except ValueError:
    print('공유 UID 거절 확인', flush=True)
else:
    raise SystemExit('공유 UID를 잘못 허용했습니다.')
for _ in range(60):
    pid = identity.unit_identity(sys.argv[3], 'ai-gate', 'ai-gate')
    status = (identity.PROC / str(pid) / 'status').read_text()
    if 'NoNewPrivs:\t0' in status:
        break
    time.sleep(.5)
else:
    raise SystemExit('NoNewPrivileges 미적용 시험 조건을 확인하지 못했습니다.')
try:
    identity.observe(sys.argv[3], client_user='vmtest')
except ValueError:
    print('NoNewPrivileges 미적용 서비스 거절 확인', flush=True)
else:
    raise SystemExit('NoNewPrivileges 미적용을 잘못 허용했습니다.')
PY
systemctl stop "$good" "$bad"
trap - ERR
echo "시험 서비스 정리 완료; 기록 보관: $records"
echo '운영 gate는 변경하지 않았습니다. 동일 UID의 다른 프로세스나 다른 접근 경로의 차단은 확인하지 않았습니다.'
