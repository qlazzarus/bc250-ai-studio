#!/usr/bin/env bash
# Test only Caddyfile backup metadata using disposable VM files.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/backup-archive.sh \
  && -f $1/deploy/model-control/restore-backup-to-stage.sh ]] || exit 1
source "$1/deploy/model-control/backup-archive.sh"
fixture=$(mktemp -d /var/backups/bc250-caddy-metadata-test.XXXXXXXX)
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
printf 'fixture caddy\n' > "$fixture/Caddyfile.original"
chmod 0644 "$fixture/Caddyfile.original"
restorecon -RF "$root" "$fixture/Caddyfile.original"
python3 - "$fixture/Caddyfile.original" <<'PY'
import os
import pwd
import struct
import sys

entries = ((1, 6, 0xffffffff), (2, 4, pwd.getpwnam('ai-studio').pw_uid),
           (4, 4, 0xffffffff), (16, 4, 0xffffffff), (32, 4, 0xffffffff))
acl = struct.pack('<I', 2) + b''.join(struct.pack('<HHI', *entry) for entry in entries)
os.setxattr(sys.argv[1], 'system.posix_acl_access', acl)
assert os.getxattr(sys.argv[1], 'system.posix_acl_access') == acl
PY
bc250_backup_archive "$root" "$backup" "$fixture/Caddyfile.original"
output=$(bash "$1/deploy/model-control/restore-backup-to-stage.sh" "$backup")
printf '%s\n' "$output"
stage=$(printf '%s\n' "$output" | sed -n 's/^복원 확인 경로: //p')
[[ $stage == /var/backups/bc250-restore-stage.* && -f $stage/Caddyfile.original ]] || exit 1
python3 - "$fixture/Caddyfile.original" "$stage/Caddyfile.original" <<'PY'
import os
import stat
import sys
from pathlib import Path

old, new = map(Path, sys.argv[1:])
a, b = old.stat(), new.stat()
assert (a.st_uid, a.st_gid, a.st_mode) == (b.st_uid, b.st_gid, b.st_mode)
assert stat.S_IMODE(b.st_mode) == 0o644
assert old.read_bytes() == new.read_bytes()
attrs = set(os.listxattr(old))
assert 'system.posix_acl_access' in attrs
assert attrs == set(os.listxattr(new))
for attr in attrs:
    assert os.getxattr(old, attr) == os.getxattr(new, attr)
print('Caddyfile 시험 권한·ACL·SELinux 등 확장 속성 복원 확인')
PY
echo "시험 파일 보관: $fixture"
