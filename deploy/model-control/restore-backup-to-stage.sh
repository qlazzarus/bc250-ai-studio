#!/usr/bin/env bash
# Candidate: restore only into a new private staging directory; no services change.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $# == 1 ]] || {
  echo 'root로 백업 디렉터리 하나를 전달하세요.' >&2; exit 1;
}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
backup=$1
python3 "$script_dir/verify-backup.py" "$backup"
[[ -d /var/backups && ! -L /var/backups && $(stat -c '%u' /var/backups) == 0 ]] || {
  echo '복원 임시 디렉터리의 상위 경로를 확인하지 못했습니다.' >&2; exit 1;
}
stage=$(mktemp -d /var/backups/bc250-restore-stage.XXXXXXXX)
echo "복원 확인 경로: $stage"
trap 'echo "복원 검증 실패. 임시 디렉터리를 보존합니다." >&2' ERR
mkdir -m 0700 "$stage/files"
tar --extract --file="$backup/legacy.tar" --acls --xattrs --xattrs-include='*' \
  --selinux --numeric-owner --same-owner --same-permissions --directory="$stage/files"
tar --compare --file="$backup/legacy.tar" --directory="$stage/files"
cp -a -- "$backup/Caddyfile.original" "$stage/Caddyfile.original"
cmp -- "$backup/Caddyfile.original" "$stage/Caddyfile.original"
echo '격리된 복원 파일의 아카이브 비교 완료; 서비스는 변경하지 않았습니다.'
