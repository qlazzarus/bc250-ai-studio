#!/usr/bin/env bash
# Observe only disposable services on a non-production port inside the test VM.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 \
  && -f $1/deploy/model-control/observe-llama-listener.py ]] || exit 1
records=$(mktemp -d /var/backups/bc250-llama-listener.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
loop="bc250-listener-loop-$suffix.service"
wild="bc250-listener-wild-$suffix.service"
other="bc250-listener-other-$suffix.service"
for unit in "$loop" "$wild" "$other"; do
  [[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
done
[[ -z $(ss -H -ltn 'sport = :18890') ]] || { echo '시험 포트가 사용 중입니다.' >&2; exit 1; }
trap 'echo "시험 중단. 시험 unit과 기록 보존: $loop $wild $other $records" >&2' ERR
systemd-run --quiet --unit="$loop" --property=Type=exec /usr/bin/python3 -m http.server 18890 --bind 127.0.0.1
systemd-run --quiet --unit="$other" --property=Type=exec /usr/bin/sleep infinity
python3 - "$1/deploy/model-control/observe-llama-listener.py" "$loop" "$other" <<'PY'
import importlib.util
import sys
import time

spec = importlib.util.spec_from_file_location('listener', sys.argv[1])
listener = importlib.util.module_from_spec(spec)
spec.loader.exec_module(listener)
for _ in range(60):
    try:
        listener.check_listener(18890, sys.argv[2])
        break
    except (OSError, ValueError):
        time.sleep(0.5)
else:
    raise SystemExit('시험 loopback 서비스 준비 시간 초과')
print('시험 서비스의 단일 IPv4 loopback 수신 및 주 프로세스 소유 확인')
try:
    listener.check_listener(18890, sys.argv[3])
except ValueError:
    print('다른 시험 서비스의 소켓 소유 주장 거절 확인')
else:
    raise SystemExit('다른 서비스의 소켓 소유 주장을 잘못 허용했습니다.')
PY
systemctl stop "$loop"
systemd-run --quiet --unit="$wild" --property=Type=exec /usr/bin/python3 -m http.server 18890 --bind 0.0.0.0
python3 - "$1/deploy/model-control/observe-llama-listener.py" "$wild" <<'PY'
import importlib.util
import sys
import time

spec = importlib.util.spec_from_file_location('listener', sys.argv[1])
listener = importlib.util.module_from_spec(spec)
spec.loader.exec_module(listener)
for _ in range(60):
    entries = listener.listening_inodes((listener.PROC / 'net/tcp').read_text(), 18890, 'tcp')
    if entries:
        break
    time.sleep(0.5)
else:
    raise SystemExit('시험 전체 인터페이스 수신 준비 시간 초과')
assert entries[0][1] == '00000000'
try:
    listener.check_listener(18890, sys.argv[2])
except ValueError:
    print('전체 인터페이스 수신 거절 확인')
else:
    raise SystemExit('전체 인터페이스 수신을 잘못 허용했습니다.')
PY
systemctl stop "$wild" "$other"
trap - ERR
echo "시험 서비스 정리 완료; 기록 보관: $records"
echo '운영 서비스는 변경하지 않았습니다. 순간 관찰이며 지속 차단·소켓 공유·다른 네임스페이스·GPU는 검증하지 않았습니다.'
