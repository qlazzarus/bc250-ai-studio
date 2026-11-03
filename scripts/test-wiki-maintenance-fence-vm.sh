#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-wiki-fence-test.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-wiki-fence-test.XXXXXXXX)
chmod 0755 "$fixture"
unit=/etc/systemd/system/bc250-wiki-fence-fixture-v2.service
runtime=/run/systemd/system/${unit##*/}
[[ ! -e $unit && ! -L $unit && ! -e $runtime && ! -L $runtime \
  && $(systemctl show "${unit##*/}" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit·mask와 기록을 보존합니다: $fixture $records $unit $runtime" >&2' ERR
for name in wiki-maintenance-fence.py check-service-cgroup.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$fixture/$name"
done
cat > "$unit" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
restorecon -RF "$fixture"
restorecon -F "$unit"
systemctl daemon-reload
systemctl start "${unit##*/}"
python3 - "$fixture" "$records" <<'PY'
import importlib.util
import subprocess
import sys
from pathlib import Path

fixture, records = map(Path, sys.argv[1:])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fixture_fence', fixture / 'wiki-maintenance-fence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.UNIT = 'bc250-wiki-fence-fixture-v2.service'
def ctl(*args, check=True):
    return subprocess.run(['/usr/bin/systemctl', *args], check=check, timeout=120,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fence = module.WikiFence(fixture / 'check-service-cgroup.py', records)
try:
    fence.acquire()
except ValueError as exc:
    if '/etc에 있는 Wiki unit' not in str(exc):
        raise
else:
    raise SystemExit('/etc 시험 unit에 위험한 runtime mask가 허용됐습니다.')
if (module.RUNTIME / module.UNIT).exists() or (module.RUNTIME / module.UNIT).is_symlink():
    raise SystemExit('시험 runtime mask가 생성됐습니다.')
if (records / 'wiki-fence.jsonl').exists():
    raise SystemExit('시험 거절 전에 차단 기록이 생성됐습니다.')
result = subprocess.run(['/usr/bin/systemctl', 'is-active', '--quiet', module.UNIT])
if result.returncode != 0:
    raise SystemExit('시험 서비스가 예상과 다르게 변경됐습니다.')
print('/etc의 시험 Wiki unit은 runtime mask 생성 전 거절 확인', flush=True)
print('시험 Wiki 서비스와 기록에 변경이 없음을 확인', flush=True)
print('운영 Wiki 직접 호출을 지속 차단하는 절차는 아직 미완성입니다.', flush=True)
PY
systemctl stop "${unit##*/}"
rm -- "$unit"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture $records"
