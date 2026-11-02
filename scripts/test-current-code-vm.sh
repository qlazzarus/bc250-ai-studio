#!/usr/bin/env bash
# Stage the current backend separately in the disposable VM; never alter services.
set -Eeuo pipefail
umask 022
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ ($# == 1 || $# == 2) && -d $1/backend/app && -f $1/pyproject.toml && -f $1/uv.lock ]] || {
  echo '현재 릴리스의 백엔드 소스와 잠금 파일이 필요합니다.' >&2; exit 1;
}
mode=${2:-worker}
[[ $mode == worker || $mode == studio ]] || exit 1
if [[ $mode == studio ]]; then
  [[ -f $1/backend/alembic/env.py && -d $1/backend/alembic/versions ]] || {
    echo 'Studio 시험에 필요한 마이그레이션 소스가 없습니다.' >&2; exit 1;
  }
fi
[[ -z $(find "$1/backend/app" -type l -print -quit) ]] || {
  echo '백엔드 소스에 심볼릭 링크가 있습니다.' >&2; exit 1;
}
if [[ -x /usr/bin/uv ]]; then uv=/usr/bin/uv
elif [[ -x /usr/local/bin/uv ]]; then uv=/usr/local/bin/uv
else echo 'root가 관리하는 uv 실행 파일이 없습니다.' >&2; exit 1
fi
[[ $(stat -Lc '%u %a' "$uv") == '0 755' ]] || {
  echo 'uv 소유권 또는 권한을 확인하지 못했습니다.' >&2; exit 1;
}
cache_source=/home/vmtest/bc250-test-source/uv-cache
[[ -d $cache_source && ! -L $cache_source ]] || {
  echo '기존 시험 VM 의존성 캐시를 찾지 못했습니다.' >&2; exit 1;
}
target=$(mktemp -d "/opt/bc250-current-$mode-candidate.XXXXXXXX")
cache=$(mktemp -d /var/cache/bc250-uv-candidate.XXXXXXXX)
chmod 0755 "$target"
trap 'echo "시험 중단. 별도 후보와 캐시를 보존합니다: $target $cache" >&2' ERR
cp -a --no-preserve=ownership "$cache_source/." "$cache/"
chmod -R go-w "$cache"
restorecon -RF "$cache"
python3 - "$cache" <<'PY'
import os
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve(strict=True)
for parent, dirs, files in os.walk(root, followlinks=False):
    for name in dirs + files:
        path = Path(parent) / name
        if path.is_symlink() and not path.resolve(strict=True).is_relative_to(root):
            raise SystemExit('시험 캐시의 심볼릭 링크가 캐시 밖을 가리킵니다.')
        info = path.lstat()
        if info.st_uid != 0:
            raise SystemExit('시험 캐시에 root 소유가 아닌 항목이 있습니다.')
        if not path.is_symlink() and info.st_mode & 0o022:
            raise SystemExit('시험 캐시에 타인이 쓸 수 있는 항목이 있습니다.')
print('기존 의존성 캐시의 별도 root 소유 복사본 확인')
PY
mkdir -m 0755 "$target/backend"
cp -R --no-preserve=ownership "$1/backend/app" "$target/backend/app"
if [[ $mode == studio ]]; then
  [[ -z $(find "$1/backend/alembic" -type l -print -quit) ]] || {
    echo '마이그레이션 소스에 심볼릭 링크가 있습니다.' >&2; exit 1;
  }
  cp -R --no-preserve=ownership "$1/backend/alembic" "$target/backend/alembic"
fi
install -o root -g root -m 0644 "$1/pyproject.toml" "$1/uv.lock" "$target/"
chmod -R go-w "$target/backend"
restorecon -RF "$target"
cd "$target"
install_options=()
if [[ $mode == worker ]]; then install_options+=(--no-editable); fi
UV_CACHE_DIR="$cache" UV_OFFLINE=1 UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy \
  "$uv" sync --locked --no-dev "${install_options[@]}" --python /usr/bin/python3
chmod -R go-w "$target"
chmod -R a+rX "$target"
restorecon -RF "$target"
[[ -z $(find "$target" ! -uid 0 -print -quit) ]] || {
  echo '후보에 root 소유가 아닌 파일이 있습니다.' >&2; exit 1;
}
[[ -z $(find "$target" ! -type l -perm /022 -print -quit) ]] || {
  echo '후보에 그룹 또는 다른 사용자가 쓸 수 있는 파일이 있습니다.' >&2; exit 1;
}
"$target/.venv/bin/python" -I - "$target" "$mode" <<'PY'
import hashlib
import sys
import tempfile
from pathlib import Path

import app
import app.gate
import app.services.client_gate_check
import app.services.model_control_runtime
import app.services.model_management_server
from app.core.config import ROOT

target = Path(sys.argv[1])
mode = sys.argv[2]
venv = Path(sys.prefix).resolve()
installed = Path(app.__file__).resolve().parent
if mode == 'worker':
    if not installed.is_relative_to(venv):
        raise SystemExit('작업자 패키지가 보호된 가상환경 밖에 있습니다.')
elif installed != (target / 'backend/app').resolve() or ROOT != target:
    raise SystemExit('Studio 패키지의 소스 또는 루트 경로가 다릅니다.')
for source in (target / 'backend/app').rglob('*.py'):
    relative = source.relative_to(target / 'backend/app')
    copy = installed / relative
    if not copy.is_file() or hashlib.sha256(source.read_bytes()).digest() != hashlib.sha256(copy.read_bytes()).digest():
        raise SystemExit(f'설치된 모듈이 시험 소스와 다릅니다: {relative}')
if mode == 'studio':
    if not (ROOT / 'backend/alembic/env.py').is_file():
        raise SystemExit('Studio 마이그레이션 경로가 없습니다.')
    from app.models.database import Database
    from sqlalchemy import text

    fixture = Path(tempfile.mkdtemp(prefix='bc250-studio-migration-', dir='/var/tmp'))
    database = Database(fixture)
    try:
        database.migrate()
        with database.engine.connect() as connection:
            revision = connection.execute(text('SELECT version_num FROM alembic_version')).scalar_one()
        if revision != '0004':
            raise SystemExit('시험 데이터베이스의 마이그레이션 버전이 다릅니다.')
    finally:
        database.engine.dispose()
    print('현재 Studio 소스·마이그레이션 경로 및 패키지 일치 확인')
    print('새 가짜 Studio 데이터베이스 마이그레이션 확인:', fixture)
else:
    print('현재 백엔드 모듈의 비편집 설치와 소스 일치 확인')
PY
echo "기존 서비스는 변경하지 않았습니다. 시험 후보 보관: $target"
