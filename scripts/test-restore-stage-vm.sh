#!/usr/bin/env bash
# Exercise isolated restoration, not a production service rollback.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/restore-backup-to-stage.sh \
  && -f $1/deploy/model-control/verify-backup.py ]] || exit 1
fixture=/var/tmp/bc250-backup-archive-test.jHO1rD8O
[[ -f $fixture/backup/legacy.tar && -f $fixture/source/etc/bc250-ai-studio.env ]] || {
  echo '이전 ACL 시험 자료를 찾지 못했습니다.' >&2; exit 1;
}
backup=$(mktemp -d /var/backups/bc250-restore-input.XXXXXXXX)
trap 'echo "시험 입력 백업을 보존합니다: $backup" >&2' ERR
cp -a "$fixture/backup/." "$backup/"
chmod 0700 "$backup"
chmod 0600 "$backup/legacy.tar" "$backup/Caddyfile.original" "$backup/SHA256SUMS"
output=$(bash "$1/deploy/model-control/restore-backup-to-stage.sh" "$backup")
printf '%s\n' "$output"
stage=$(printf '%s\n' "$output" | sed -n 's/^복원 확인 경로: //p')
[[ $stage == /var/backups/bc250-restore-stage.* && -d $stage/files ]] || exit 1
python3 - "$fixture/source/etc/bc250-ai-studio.env" "$stage/files/etc/bc250-ai-studio.env" <<'PY'
import os
import sys

old, new = sys.argv[1:]
for attr in ('system.posix_acl_access', 'security.selinux'):
    assert os.getxattr(old, attr) == os.getxattr(new, attr), attr
print('격리 복원 후 추가 ACL 및 SELinux 속성 일치 확인')
PY
echo "시험 백업과 복원 결과 보관: $backup / $stage"
