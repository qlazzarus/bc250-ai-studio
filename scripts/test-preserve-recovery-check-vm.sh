#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
evidence=/var/backups/bc250-model-postfailure.vIroPkbF
[[ -d $evidence && ! -L $evidence && $(stat -c '%u %a' "$evidence") == '0 700' ]] || {
  echo '이전 시험 보존 기록을 확인하지 못했습니다.' >&2; exit 1;
}
for unit in bc250-ai-studio.service bc250-llm-gate.service bc250-model-worker.service \
  bc250-model-api.service bc250-model-worker.socket llama-server.service; do
  [[ $(systemctl show "$unit" -p LoadState --value) == loaded \
    && $(systemctl show "$unit" -p ActiveState --value) == inactive \
    && -z $(systemctl show "$unit" -p Job --value) ]] || {
    echo "시험 unit 정지 상태 확인 실패: $unit" >&2; exit 1;
  }
done
client=/run/systemd/system/bc250-llm-client.service
[[ ! -e $client && ! -L $client && ! -e /etc/systemd/system/bc250-llm-client.service \
  && ! -L /etc/systemd/system/bc250-llm-client.service \
  && $(systemctl show bc250-llm-client.service -p LoadState --value) == not-found ]] || exit 1
tools=$(mktemp -d /opt/bc250-preserved-recovery.XXXXXXXX)
chmod 0755 "$tools"
copy=$(mktemp -d /var/backups/bc250-model-postfailure.XXXXXXXX)
trap 'echo "시험 중단. unit과 보존 복사본을 유지합니다: $tools $copy" >&2' ERR
for name in preserve-new-adapter.py preserve-new-stopped.sh preserve-new-archive.sh \
  backup-archive.sh check-service-cgroup.py check-preserved-switch-state.py check-new-switch-state.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$tools/$name"
done
cp -a --reflink=auto "$evidence/." "$copy/"
cat > "$client" <<'EOF'
[Unit]
Description=Disposable stopped client for preservation verification
[Service]
ExecStart=/usr/bin/sleep 600
KillMode=control-group
EOF
restorecon -RF "$tools"
restorecon -F "$client"
systemctl daemon-reload
python3 - "$tools" "$evidence" "$copy" <<'PY'
import importlib.util
import sys
from pathlib import Path

tools, evidence, copy = map(Path, sys.argv[1:])
spec = importlib.util.spec_from_file_location('preserve_adapter', tools / 'preserve-new-adapter.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
adapter = module.PreserveNewAdapter(tools, check_maintenance=lambda: True,
                                    inspect_live=lambda: True, check_local_idle=lambda: True)
if adapter.recovery_safe(evidence, check_model=lambda: True) is not True:
    raise SystemExit('시험 보존 상태 검증에 실패했습니다.')
print('이전 시험 아카이브의 미완료 작업·hold와 systemd 기록 체크섬 확인', flush=True)
with (copy / 'systemd-journal.log').open('ab') as file:
    file.write(b'fixture tampering\n')
try:
    adapter.recovery_safe(copy, check_model=lambda: True)
except ValueError:
    print('시험 systemd 기록 변조 시 복원 전 거절 확인', flush=True)
else:
    raise SystemExit('변조된 시험 systemd 기록을 허용했습니다.')
print('유지보수·로컬 유휴·모델 health 검사는 모의입니다.', flush=True)
PY
rm -- "$client"
systemctl daemon-reload
echo "시험 Client unit 정리 완료; 변조 복사본 보존: $copy"
