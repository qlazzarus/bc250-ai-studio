#!/usr/bin/env bash
# Connect the already-installed Studio fixture to the existing isolated VM services.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ ( $# == 1 || ( $# == 2 && ( $2 == repair-lock || $2 == startup-phases ) ) ) \
  && -f $1/scripts/test-api-services-vm.sh && -d $1/backend/app ]] || exit 1
source_dir=$1
worker=/opt/bc250-current-code-candidate.YS6DiOo6
[[ -d $worker && ! -L $worker && $(stat -c '%u %a' "$worker") == '0 755' \
  && -x $worker/.venv/bin/python ]] || { echo '기존 시험 작업자 후보가 없습니다.' >&2; exit 1; }
studios=()
for path in /opt/bc250-studio-fixture-*; do
  [[ -d $path && ! -L $path && $(stat -c '%u %a' "$path") == '0 755' \
    && -x $path/.venv/bin/python && -f $path/backend/app/main.py ]] || continue
  studios+=("$path")
done
[[ ${#studios[@]} == 1 ]] || {
  echo "성공한 시험 Studio 후보를 하나로 확인하지 못했습니다: ${#studios[@]}개" >&2; exit 1;
}
studio=${studios[0]}
echo "연결할 기존 시험 Studio 후보: $studio"
if [[ ${2:-} == repair-lock ]]; then
  python3 - "$studio" <<'PY'
import fcntl
import hashlib
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path

root = Path(sys.argv[1])
allowed = root / '.venv/.lock'
writable = []
def onerror(error):
    raise error
for parent, dirs, files in os.walk(root, followlinks=False, onerror=onerror):
    for name in dirs + files:
        path = Path(parent) / name
        info = path.lstat()
        if info.st_uid != 0:
            raise SystemExit('시험 후보에 root가 소유하지 않은 항목이 있습니다.')
        if not stat.S_ISLNK(info.st_mode) and info.st_mode & 0o022:
            writable.append(path)
if writable != [allowed]:
    raise SystemExit('쓰기 가능한 항목이 예상한 단일 uv 잠금 파일이 아닙니다. 상태를 보존합니다.')
fd = os.open(allowed, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o666:
        raise SystemExit('시험 uv 잠금 파일의 속성이 예상과 다릅니다.')
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    evidence = Path(tempfile.mkdtemp(prefix='bc250-fixture-lock-', dir='/var/backups'))
    before = evidence / 'lock-before'
    shutil.copy2(allowed, before, follow_symlinks=False)
    def digest(path):
        with path.open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').digest()
    old_hash = digest(before)
    attrs = {key: os.getxattr(allowed, key, follow_symlinks=False)
             for key in os.listxattr(allowed, follow_symlinks=False)}
    current = allowed.lstat()
    if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino) or digest(allowed) != old_hash:
        raise SystemExit('시험 잠금 파일이 변경됐습니다. 상태를 보존합니다.')
    os.fchmod(fd, 0o644)
    os.fsync(fd)
    after = allowed.lstat()
    if ((after.st_dev, after.st_ino, after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode))
            != (info.st_dev, info.st_ino, info.st_uid, info.st_gid, 0o644)
            or digest(allowed) != old_hash
            or attrs != {key: os.getxattr(allowed, key, follow_symlinks=False)
                         for key in os.listxattr(allowed, follow_symlinks=False)}):
        raise SystemExit('시험 잠금 파일 권한 변경 결과를 확인하지 못했습니다.')
    print('시험 uv 잠금 파일만 쓰기 권한을 제한했습니다. 원본 보관:', evidence, flush=True)
finally:
    os.close(fd)
PY
fi
for candidate in "$worker" "$studio"; do
  [[ -z $(find "$candidate" ! -uid 0 -print -quit) \
    && -z $(find "$candidate" ! -type l -perm /022 -print -quit) ]] || {
    echo '시험 후보의 소유권 또는 쓰기 권한을 확인하지 못했습니다.' >&2; exit 1;
  }
  "$candidate/.venv/bin/python" -I - "$source_dir/backend/app" <<'PY'
import hashlib
import sys
from pathlib import Path
import app

source = Path(sys.argv[1])
installed = Path(app.__file__).resolve().parent
for file in source.rglob('*.py'):
    candidate = installed / file.relative_to(source)
    if not candidate.is_file() or hashlib.sha256(file.read_bytes()).digest() != hashlib.sha256(candidate.read_bytes()).digest():
        raise SystemExit('시험 후보와 현재 백엔드 소스가 다릅니다.')
PY
done
"$studio/.venv/bin/python" -I - "$studio" "$source_dir/backend/alembic" <<'PY'
import hashlib
import sys
from pathlib import Path
from app.core.config import ROOT

studio, source = map(Path, sys.argv[1:])
if ROOT != studio:
    raise SystemExit('시험 Studio 루트 경로가 다릅니다.')
for file in source.rglob('*.py'):
    candidate = studio / 'backend/alembic' / file.relative_to(source)
    if not candidate.is_file() or hashlib.sha256(file.read_bytes()).digest() != hashlib.sha256(candidate.read_bytes()).digest():
        raise SystemExit('시험 Studio 마이그레이션 파일이 다릅니다.')
print('기설치 Studio·작업자 소스와 마이그레이션 일치 확인', flush=True)
PY
units=(bc250-ai-studio.service bc250-llm-gate.service bc250-model-worker.service bc250-model-api.service)
for unit in "${units[@]}" bc250-model-worker.socket llama-server.service; do
  [[ $(systemctl show "$unit" -p LoadState --value) == loaded \
    && $(systemctl show "$unit" -p ActiveState --value) == inactive \
    && -z $(systemctl show "$unit" -p Job --value) ]] || {
    echo "시험 서비스가 정지 상태가 아닙니다: $unit" >&2; exit 1;
  }
done
for unit in "${units[@]}"; do
  directory=/run/systemd/system/$unit.d
  [[ ! -L $directory && ! -e $directory/zz-bc250-installed-test.conf \
    && ! -L $directory/zz-bc250-installed-test.conf ]] || exit 1
  if [[ -e $directory ]]; then
    [[ -d $directory && $(stat -c '%u' "$directory") == 0 \
      && -z $(find "$directory" -maxdepth 0 -perm /022 -print) ]] || exit 1
  else
    install -d -o root -g root -m 0755 "$directory"
  fi
done
entry=$(mktemp -d /opt/bc250-installed-studio-entry.XXXXXXXX)
chmod 0755 "$entry"
trap 'echo "시험 중단. 시험 서비스·보류·임시 설정을 보존합니다: $entry" >&2' ERR
cat > "$entry/vm_studio.py" <<'PY'
from app.core.config import Settings
from app.main import create_app
from app.services.llm import SystemdLLM

def create_test_app():
    settings = Settings()
    return create_app(settings, llm=SystemdLLM(settings))
PY
chmod 0644 "$entry/vm_studio.py"
cat > /run/systemd/system/bc250-ai-studio.service.d/zz-bc250-installed-test.conf <<EOF
[Service]
ExecStart=
ExecStart=$studio/.venv/bin/python -I -m uvicorn --app-dir $entry vm_studio:create_test_app --factory --host 127.0.0.1 --port 8090 --workers 1 --no-access-log
EOF
cat > /run/systemd/system/bc250-llm-gate.service.d/zz-bc250-installed-test.conf <<EOF
[Service]
ExecStart=
ExecStart=$worker/.venv/bin/python -I -m uvicorn app.gate:create_gate_app --factory --host 127.0.0.1 --port 8081 --workers 1 --no-access-log
EOF
cat > /run/systemd/system/bc250-model-worker.service.d/zz-bc250-installed-test.conf <<EOF
[Service]
ExecStart=
ExecStart=$worker/.venv/bin/python -I -m app.services.model_control_runtime
EOF
cat > /run/systemd/system/bc250-model-api.service.d/zz-bc250-installed-test.conf <<EOF
[Service]
ExecStart=
ExecStart=$worker/.venv/bin/python -I -m uvicorn app.services.model_management_server:create_app --factory --host 127.0.0.1 --port 8091 --workers 1 --no-access-log
EOF
restorecon -RF "$entry"
for unit in "${units[@]}"; do
  restorecon -F "/run/systemd/system/$unit.d/zz-bc250-installed-test.conf"
done
systemctl daemon-reload
if [[ ${2:-} == startup-phases ]]; then
  bash "$source_dir/scripts/test-new-service-start-vm.sh" "$source_dir" "$worker" "$entry"
else
  bash "$source_dir/scripts/test-api-services-vm.sh" "$source_dir" "$worker" "$studio"
fi
for unit in "${units[@]}"; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == inactive \
    && $(systemctl show "$unit" -p MainPID --value) == 0 ]] || {
    echo "시험 서비스가 완전히 정지되지 않았습니다: $unit" >&2; exit 1;
  }
done
for unit in "${units[@]}"; do
  rm -- "/run/systemd/system/$unit.d/zz-bc250-installed-test.conf"
done
systemctl daemon-reload
echo '기설치 Studio 후보의 서비스 연결 시험과 임시 설정 정리 완료'
