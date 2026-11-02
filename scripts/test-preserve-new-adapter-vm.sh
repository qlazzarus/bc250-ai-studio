#!/usr/bin/env bash
# Exercise the real preservation wrapper against stopped VM fixtures only.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
for unit in bc250-ai-studio.service bc250-llm-gate.service bc250-model-worker.service \
  bc250-model-api.service bc250-model-worker.socket llama-server.service; do
  [[ $(systemctl show "$unit" -p LoadState --value) == loaded \
    && $(systemctl show "$unit" -p ActiveState --value) == inactive \
    && -z $(systemctl show "$unit" -p Job --value) ]] || {
    echo "시험 unit이 완전히 정지되지 않았습니다: $unit" >&2; exit 1;
  }
done
client=/run/systemd/system/bc250-llm-client.service
[[ ! -e $client && ! -L $client && ! -e /etc/systemd/system/bc250-llm-client.service \
  && ! -L /etc/systemd/system/bc250-llm-client.service ]] || {
  echo '시험 Client unit이 이미 존재합니다.' >&2; exit 1;
}
[[ $(systemctl show bc250-llm-client.service -p LoadState --value) == not-found ]] || {
  echo '기존 Client unit이 발견되어 시험을 중단합니다.' >&2; exit 1;
}
for path in /var/lib/bc250-model-control /var/lib/bc250-llm-gate /etc/bc250-model-control; do
  [[ -d $path && ! -L $path ]] || { echo "시험 상태 디렉터리가 없습니다: $path" >&2; exit 1; }
done
for path in /var/lib/bc250-model-control/switch.json /var/lib/bc250-llm-gate/holds.json; do
  [[ -f $path && ! -L $path ]] || { echo "시험 상태 파일이 없습니다: $path" >&2; exit 1; }
done
tools=$(mktemp -d /opt/bc250-preserve-adapter.XXXXXXXX)
chmod 0755 "$tools"
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $tools" >&2' ERR
data_dir=/opt/ai-studio-data
created_data=no
if [[ ! -e $data_dir && ! -L $data_dir ]]; then
  install -d -o ai-studio -g ai-studio -m 0700 "$data_dir"
  printf '%s\n' 'isolated preservation fixture' > "$data_dir/.bc250-preserve-fixture"
  chown ai-studio:ai-studio "$data_dir/.bc250-preserve-fixture"
  chmod 0600 "$data_dir/.bc250-preserve-fixture"
  restorecon -RF "$data_dir"
  created_data=yes
  echo '시험 VM에 가짜 Studio 데이터 디렉터리 생성'
fi
[[ -d $data_dir && ! -L $data_dir ]] || { echo '시험 Studio 데이터 경로가 올바르지 않습니다.' >&2; exit 1; }
for name in preserve-new-adapter.py preserve-new-stopped.sh preserve-new-archive.sh \
  backup-archive.sh check-service-cgroup.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$tools/$name"
done
cat > "$client" <<'EOF'
[Unit]
Description=Disposable stopped client for preservation test
[Service]
ExecStart=/usr/bin/sleep 600
KillMode=control-group
EOF
restorecon -RF "$tools"
restorecon -F "$client"
systemctl daemon-reload
python3 - "$tools" <<'PY'
import importlib.util
import subprocess
import sys
from pathlib import Path

tools = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('preserve_adapter', tools / 'preserve-new-adapter.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
adapter = module.PreserveNewAdapter(tools, check_maintenance=lambda: True,
                                    inspect_live=lambda: True, check_local_idle=lambda: True)
evidence = adapter.preserve()
for name in ('new-state.tar', 'NEW-STATE-SHA256SUMS', 'systemd-journal.log', 'SYSTEMD-SHA256SUMS'):
    path = evidence / name
    if not path.is_file() or path.is_symlink():
        raise SystemExit('시험 상태 보존 결과가 불완전합니다.')
subprocess.run(['/usr/bin/sha256sum', '-c', 'NEW-STATE-SHA256SUMS'], cwd=evidence,
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(['/usr/bin/sha256sum', '-c', 'SYSTEMD-SHA256SUMS'], cwd=evidence,
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print('시험 VM의 정지 상태·신규 상태 아카이브·systemd 기록 및 체크섬 확인', flush=True)
print('유지보수와 로컬 유휴 검사는 모의; 보존 경로:', evidence, flush=True)
PY
rm -- "$client"
systemctl daemon-reload
if [[ $created_data == yes ]]; then
  marker=$data_dir/.bc250-preserve-fixture
  [[ -f $marker && ! -L $marker \
    && $(cat "$marker") == 'isolated preservation fixture' \
    && $(find "$data_dir" -mindepth 1 -maxdepth 1 -printf '%f\n') == '.bc250-preserve-fixture' ]] || {
    echo "시험 데이터가 변경돼 정리하지 않았습니다: $data_dir" >&2; exit 1;
  }
  rm -- "$marker"
  rmdir -- "$data_dir"
  echo '생성한 가짜 Studio 데이터 디렉터리 정리 완료'
fi
echo "시험 Client unit 정리 완료; 시험 도구 보관: $tools"
