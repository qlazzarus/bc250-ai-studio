#!/usr/bin/env bash
# Test the changed backup and verification against disposable files in the VM.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/backup-archive.sh \
  && -f $1/deploy/model-control/restore-backup-to-stage.sh \
  && -f $1/deploy/model-control/verify-backup.py ]] || exit 1
source "$1/deploy/model-control/backup-archive.sh"
fixture=$(mktemp -d /var/backups/bc250-dropin-test.XXXXXXXX)
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture" >&2' ERR
root=$fixture/source
backup=$fixture/backup
mkdir -p "$root/opt/bc250-ai-studio" "$root/opt/ai-studio-data" \
  "$root/opt/ai/config" "$root/etc/systemd/system" \
  "$root/var/lib/bc250-model-control" "$backup"
printf 'fake\n' > "$root/opt/ai/config/active-model.conf"
printf '{"paused_before_maintenance":false}\n' > "$root/var/lib/bc250-model-control/legacy-pause.json"
for name in bc250-ai-studio bc250-llm-gate bc250-llm-client; do
  printf 'fixture\n' > "$root/etc/$name.env"
  printf 'fixture\n' > "$root/etc/systemd/system/$name.service"
done
dropin=etc/systemd/system/bc250-llm-gate.service.d
mkdir -p "$root/$dropin"
printf '[Service]\nRestartSec=7\n' > "$root/$dropin/override.conf"
printf 'fixture\n' > "$fixture/Caddyfile.original"
chmod 0600 "$fixture/Caddyfile.original"
restorecon -RF "$root" "$fixture/Caddyfile.original"
bc250_backup_archive "$root" "$backup" "$fixture/Caddyfile.original"
output=$(bash "$1/deploy/model-control/restore-backup-to-stage.sh" "$backup")
printf '%s\n' "$output"
stage=$(printf '%s\n' "$output" | sed -n 's/^복원 확인 경로: //p')
[[ $stage == /var/backups/bc250-restore-stage.* && -d $stage/files ]] || exit 1
cmp "$root/$dropin/override.conf" "$stage/files/$dropin/override.conf"
python3 - "$root/$dropin/override.conf" "$stage/files/$dropin/override.conf" <<'PY'
import os
import sys
from pathlib import Path
old, new = map(Path, sys.argv[1:])
a, b = old.stat(), new.stat()
assert (a.st_uid, a.st_gid, a.st_mode) == (b.st_uid, b.st_gid, b.st_mode)
assert set(os.listxattr(old)) == set(os.listxattr(new))
for attr in os.listxattr(old):
    assert os.getxattr(old, attr) == os.getxattr(new, attr)
print('시험 drop-in 내용·소유권·권한·확장 속성 복원 확인')
PY
echo "시험 파일 보관: $fixture"
