#!/usr/bin/env bash
# Use a separately installed candidate through temporary VM-only unit drop-ins.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 1 && -f $1/scripts/test-api-services-vm.sh && -d $1/backend/app ]] || exit 1
source_dir=$1
candidate=/opt/bc250-current-code-candidate.YS6DiOo6
[[ -d $candidate && ! -L $candidate && $(stat -c '%u %a' "$candidate") == '0 755' \
  && -x $candidate/.venv/bin/python ]] || {
  echo '기존 시험 후보의 소유권 또는 실행 파일을 확인하지 못했습니다.' >&2; exit 1;
}
[[ -z $(find "$candidate" ! -uid 0 -print -quit) \
  && -z $(find "$candidate" ! -type l -perm /022 -print -quit) ]] || {
  echo '시험 후보의 소유권 또는 쓰기 권한이 올바르지 않습니다.' >&2; exit 1;
}
"$candidate/.venv/bin/python" -I - "$source_dir/backend/app" <<'PY'
import hashlib
import sys
from pathlib import Path
import app

source = Path(sys.argv[1])
installed = Path(app.__file__).resolve().parent
if not installed.is_relative_to(Path(sys.prefix).resolve()):
    raise SystemExit('시험 패키지가 후보 가상환경 밖에 있습니다.')
for path in source.rglob('*.py'):
    copy = installed / path.relative_to(source)
    if not copy.is_file() or hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(copy.read_bytes()).digest():
        raise SystemExit('시험 후보와 현재 소스가 다릅니다. 새 후보를 준비하세요.')
print('시험 후보와 현재 백엔드 소스 일치 확인')
PY
units=(bc250-ai-studio.service bc250-llm-gate.service bc250-model-worker.service bc250-model-api.service)
for unit in "${units[@]}" bc250-model-worker.socket llama-server.service; do
  [[ $(systemctl show "$unit" -p LoadState --value) == loaded \
    && $(systemctl show "$unit" -p ActiveState --value) == inactive ]] || {
    echo "시험 서비스가 정지 상태가 아닙니다: $unit" >&2; exit 1;
  }
done
for unit in "${units[@]}"; do
  directory=/run/systemd/system/$unit.d
  [[ ! -L $directory && ! -e $directory/zz-bc250-current-test.conf \
    && ! -L $directory/zz-bc250-current-test.conf ]] || {
    echo "시험 drop-in 경로가 이미 존재합니다: $unit" >&2; exit 1;
  }
done
entry=$(mktemp -d /opt/bc250-current-studio-entry.XXXXXXXX)
chmod 0755 "$entry"
trap 'echo "시험 중단. 서비스·보류·임시 unit 설정을 보존합니다: $entry" >&2' ERR
cat > "$entry/vm_studio.py" <<'PY'
from app.core.config import Settings
from app.main import create_app
from app.services.llm import SystemdLLM

def create_test_app():
    settings = Settings()
    return create_app(settings, llm=SystemdLLM(settings))
PY
chmod 0644 "$entry/vm_studio.py"
for unit in "${units[@]}"; do
  directory=/run/systemd/system/$unit.d
  if [[ -e $directory ]]; then
    [[ -d $directory && ! -L $directory && $(stat -c '%u' "$directory") == 0 \
      && -z $(find "$directory" -maxdepth 0 -perm /022 -print) ]] || exit 1
  else
    install -d -o root -g root -m 0755 "$directory"
  fi
done
cat > /run/systemd/system/bc250-ai-studio.service.d/zz-bc250-current-test.conf <<EOF
[Service]
ExecStart=
ExecStart=$candidate/.venv/bin/python -I -m uvicorn --app-dir $entry vm_studio:create_test_app --factory --host 127.0.0.1 --port 8090 --workers 1 --no-access-log
EOF
cat > /run/systemd/system/bc250-llm-gate.service.d/zz-bc250-current-test.conf <<EOF
[Service]
ExecStart=
ExecStart=$candidate/.venv/bin/python -I -m uvicorn app.gate:create_gate_app --factory --host 127.0.0.1 --port 8081 --workers 1 --no-access-log
EOF
cat > /run/systemd/system/bc250-model-worker.service.d/zz-bc250-current-test.conf <<EOF
[Service]
ExecStart=
ExecStart=$candidate/.venv/bin/python -I -m app.services.model_control_runtime
EOF
cat > /run/systemd/system/bc250-model-api.service.d/zz-bc250-current-test.conf <<EOF
[Service]
ExecStart=
ExecStart=$candidate/.venv/bin/python -I -m uvicorn app.services.model_management_server:create_app --factory --host 127.0.0.1 --port 8091 --workers 1 --no-access-log
EOF
restorecon -RF "$entry"
for unit in "${units[@]}"; do
  restorecon -F "/run/systemd/system/$unit.d/zz-bc250-current-test.conf"
done
systemctl daemon-reload
bash "$source_dir/scripts/test-api-services-vm.sh" "$source_dir" "$candidate"
for unit in "${units[@]}"; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == inactive ]] || {
    echo "시험 서비스가 아직 정지되지 않았습니다: $unit" >&2; exit 1;
  }
done
for unit in "${units[@]}"; do
  rm -- "/run/systemd/system/$unit.d/zz-bc250-current-test.conf"
done
systemctl daemon-reload
echo '현재 후보 서비스 연결 시험 완료; 임시 unit 설정 제거 및 기존 설정 복귀 확인'
