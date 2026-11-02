#!/usr/bin/env bash
# Continue the interrupted release test with distinct Studio and worker installs.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 1 && -f $1/scripts/test-api-services-vm.sh \
  && -d $1/backend/app && -d $1/backend/alembic ]] || exit 1
source_dir=$1
worker=/opt/bc250-current-code-candidate.YS6DiOo6
studio=/opt/bc250-current-studio-candidate.m8wrru6t
for candidate in "$worker" "$studio"; do
  [[ -d $candidate && ! -L $candidate && $(stat -c '%u %a' "$candidate") == '0 755' \
    && -x $candidate/.venv/bin/python \
    && -z $(find "$candidate" ! -uid 0 -print -quit) \
    && -z $(find "$candidate" ! -type l -perm /022 -print -quit) ]] || {
    echo '시험 후보의 경로 또는 소유권을 확인하지 못했습니다.' >&2; exit 1;
  }
done
for candidate in "$worker" "$studio"; do
  "$candidate/.venv/bin/python" -I - "$source_dir/backend/app" <<'PY'
import hashlib
import sys
from pathlib import Path
import app

source = Path(sys.argv[1])
installed = Path(app.__file__).resolve().parent
for path in source.rglob('*.py'):
    copy = installed / path.relative_to(source)
    if not copy.is_file() or hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(copy.read_bytes()).digest():
        raise SystemExit('시험 후보와 현재 백엔드 소스가 다릅니다.')
PY
done
"$studio/.venv/bin/python" -I - "$studio" "$source_dir/backend/alembic" <<'PY'
import hashlib
import sys
from pathlib import Path
from app.core.config import ROOT

target, source = map(Path, sys.argv[1:])
if ROOT != target:
    raise SystemExit('시험 Studio 루트 경로가 다릅니다.')
for path in source.rglob('*.py'):
    copy = target / 'backend/alembic' / path.relative_to(source)
    if not copy.is_file() or hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(copy.read_bytes()).digest():
        raise SystemExit('시험 Studio 마이그레이션 소스가 다릅니다.')
print('Studio 및 작업자 후보와 현재 소스 일치 확인')
PY
units=(bc250-ai-studio.service bc250-llm-gate.service bc250-model-worker.service bc250-model-api.service)
for name in "${units[@]}" bc250-model-worker.socket llama-server.service; do
  state=$(systemctl show "$name" -p ActiveState --value)
  if [[ $name == bc250-ai-studio.service ]]; then
    [[ $state == inactive || $state == failed ]] || { echo "시험 서비스가 실행 중입니다: $name" >&2; exit 1; }
  else
    [[ $state == inactive ]] || { echo "시험 서비스가 정지 상태가 아닙니다: $name" >&2; exit 1; }
  fi
  [[ -z $(systemctl show "$name" -p Job --value) ]] || exit 1
done
for name in "${units[@]}" llama-server.service; do
  [[ $(systemctl show "$name" -p MainPID --value) == 0 ]] || exit 1
done
for name in "${units[@]}"; do
  old=/run/systemd/system/$name.d/zz-bc250-current-test.conf
  [[ -f $old && ! -L $old && $(stat -c '%u' "$old") == 0 ]] || {
    echo "이전 시험 drop-in을 확인하지 못했습니다: $name" >&2; exit 1;
  }
  grep -Fq "$worker/.venv/bin/python -I -m" "$old" || {
    echo "이전 시험 drop-in이 예상과 다릅니다: $name" >&2; exit 1;
  }
done
new=/run/systemd/system/bc250-ai-studio.service.d/zzz-bc250-separated-test.conf
[[ ! -e $new && ! -L $new ]] || { echo '새 시험 drop-in이 이미 있습니다.' >&2; exit 1; }
evidence=$(mktemp -d /var/backups/bc250-separated-services.XXXXXXXX)
entry=$(mktemp -d /opt/bc250-separated-studio-entry.XXXXXXXX)
chmod 0755 "$entry"
trap 'echo "시험 중단. 서비스와 상태를 보존합니다: $evidence $entry" >&2' ERR
for name in "${units[@]}"; do
  cp -a "/run/systemd/system/$name.d/zz-bc250-current-test.conf" "$evidence/$name.conf"
done
systemctl show bc250-ai-studio.service -p ActiveState -p SubState -p Result -p MainPID \
  -p Job -p ExecMainCode -p ExecMainStatus > "$evidence/studio-state.txt"
journalctl -u bc250-ai-studio.service -b --no-pager -o short-precise > "$evidence/studio-journal.txt"
[[ -d /opt/bc250-studio-test-data && ! -L /opt/bc250-studio-test-data ]] || {
  echo '기존 시험 Studio 데이터 경로를 확인하지 못했습니다.' >&2; exit 1;
}
cp -a /opt/bc250-studio-test-data "$evidence/studio-data"
cat > "$entry/vm_studio.py" <<'PY'
from app.core.config import Settings
from app.main import create_app
from app.services.llm import SystemdLLM

def create_test_app():
    settings = Settings()
    return create_app(settings, llm=SystemdLLM(settings))
PY
chmod 0644 "$entry/vm_studio.py"
cat > "$new" <<EOF
[Service]
ExecStart=
ExecStart=$studio/.venv/bin/python -I -m uvicorn --app-dir $entry vm_studio:create_test_app --factory --host 127.0.0.1 --port 8090 --workers 1 --no-access-log
EOF
restorecon -RF "$entry"
restorecon -F "$new"
systemctl daemon-reload
systemctl reset-failed bc250-ai-studio.service
bash "$source_dir/scripts/test-api-services-vm.sh" "$source_dir" "$worker" "$studio"
for name in "${units[@]}"; do
  [[ $(systemctl show "$name" -p ActiveState --value) == inactive \
    && $(systemctl show "$name" -p MainPID --value) == 0 ]] || {
    echo "시험 서비스가 완전히 정지되지 않았습니다: $name" >&2; exit 1;
  }
done
rm -- "$new"
for name in "${units[@]}"; do
  rm -- "/run/systemd/system/$name.d/zz-bc250-current-test.conf"
done
systemctl daemon-reload
echo "분리된 Studio·작업자 후보 연결 시험 및 임시 설정 정리 완료. 이전 실패 기록 보관: $evidence"
