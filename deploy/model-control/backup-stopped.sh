#!/usr/bin/env bash
# Candidate only: snapshot stopped legacy services; never starts or stops them.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $# == 1 ]] || {
  echo 'root로 보존된 기존 Caddyfile 경로를 전달하세요.' >&2; exit 1;
}
caddy_original=$1
[[ $caddy_original == /* && -f $caddy_original && ! -L $caddy_original ]] || {
  echo '보존된 기존 Caddyfile을 확인할 수 없습니다.' >&2; exit 1;
}
[[ $(stat -c '%u %a %h' "$caddy_original") == '0 600 1' ]] || {
  echo '보존된 Caddyfile은 root 소유 0600 단일 링크여야 합니다.' >&2; exit 1;
}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
python3 - "$caddy_original" "$script_dir/backup-archive.sh" <<'PY'
import os
import stat
import sys
from pathlib import Path

for text in sys.argv[1:]:
    path = Path(text)
    if not path.is_absolute() or '..' in path.parts:
        raise SystemExit('신뢰할 수 없는 경로입니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise SystemExit('신뢰할 수 없는 소유권 또는 경로 권한입니다.')
        if item != path and not stat.S_ISDIR(info.st_mode):
            raise SystemExit('상위 경로가 디렉터리가 아닙니다.')
PY
source "$script_dir/backup-archive.sh"
bc250_require_stopped bc250-ai-studio.service bc250-llm-gate.service bc250-llm-client.service
[[ -d /var/backups && ! -L /var/backups && $(stat -c '%u' /var/backups) == 0 ]] || {
  echo '백업 상위 경로 확인 실패' >&2; exit 1;
}
backup=$(mktemp -d /var/backups/bc250-model-migration.XXXXXXXX)
echo "백업 경로: $backup"
trap 'echo "백업이 완료되지 않았습니다. 해당 디렉터리를 보존하고 조사하세요." >&2' ERR
bc250_backup_archive / "$backup" "$caddy_original"
printf '%s\n' '백업 파일과 체크섬을 만들었습니다. 복원 절차 검증은 별도로 필요합니다.'
