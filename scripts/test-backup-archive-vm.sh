#!/usr/bin/env bash
# Exercise the actual archive function against disposable VM fixture files only.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f "$1/deploy/model-control/backup-archive.sh" ]] || {
  echo '시험 소스가 필요합니다.' >&2; exit 1;
}
fixture=$(mktemp -d /var/tmp/bc250-backup-archive-test.XXXXXXXX)
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture" >&2' ERR
root=$fixture/source
backup=$fixture/backup
restored=$fixture/restored
mkdir -p "$root/opt/bc250-ai-studio/backend" "$root/opt/ai-studio-data" \
  "$root/opt/ai/config" "$root/etc/systemd/system" \
  "$root/var/lib/bc250-model-control" "$backup" "$restored"
printf 'fixture code\n' > "$root/opt/bc250-ai-studio/backend/main.py"
printf 'fixture data\n' > "$root/opt/ai-studio-data/data.db"
printf 'ACTIVE_MODEL=fake\n' > "$root/opt/ai/config/active-model.conf"
printf '{"paused_before_maintenance":true}\n' > "$root/var/lib/bc250-model-control/legacy-pause.json"
for name in bc250-ai-studio bc250-llm-gate bc250-llm-client; do
  printf 'fixture secret\n' > "$root/etc/$name.env"
  printf 'fixture unit\n' > "$root/etc/systemd/system/$name.service"
  chmod 0600 "$root/etc/$name.env"
done
printf 'fixture caddy\n' > "$fixture/Caddyfile.original"
chmod 0600 "$fixture/Caddyfile.original"
chmod 0700 "$root/opt/ai-studio-data"
chown -R ai-studio:ai-studio "$root/opt/ai-studio-data"
ln -s backend/main.py "$root/opt/bc250-ai-studio/current"
restorecon -RF "$root" "$fixture/Caddyfile.original"
python3 - "$root/etc/bc250-ai-studio.env" <<'PY'
import os
import pwd
import struct
import sys

# Linux POSIX ACL xattr: owner, named user, group, mask, other.
entries = ((1, 6, 0xffffffff), (2, 4, pwd.getpwnam('ai-studio').pw_uid),
           (4, 0, 0xffffffff), (16, 4, 0xffffffff), (32, 0, 0xffffffff))
acl = struct.pack('<I', 2) + b''.join(struct.pack('<HHI', *entry) for entry in entries)
os.setxattr(sys.argv[1], 'system.posix_acl_access', acl)
assert os.getxattr(sys.argv[1], 'system.posix_acl_access') == acl
print('시험용 추가 ACL 생성 확인')
PY
source "$1/deploy/model-control/backup-archive.sh"
bc250_backup_archive "$root" "$backup" "$fixture/Caddyfile.original"
(cd "$backup" && sha256sum -c SHA256SUMS)
tar --extract --file="$backup/legacy.tar" --acls --xattrs --xattrs-include='*' \
  --selinux --numeric-owner --same-owner --same-permissions --directory="$restored"
python3 - "$root" "$restored" "$fixture/Caddyfile.original" "$backup/Caddyfile.original" <<'PY'
import os
import stat
import sys
from pathlib import Path

source, restored = map(Path, sys.argv[1:3])
for relative in (
    'opt/bc250-ai-studio/backend/main.py', 'opt/bc250-ai-studio/current',
    'opt/ai-studio-data', 'opt/ai-studio-data/data.db',
    'opt/ai/config/active-model.conf', 'etc/bc250-ai-studio.env',
    'etc/bc250-llm-gate.env', 'etc/bc250-llm-client.env',
    'etc/systemd/system/bc250-ai-studio.service',
    'var/lib/bc250-model-control/legacy-pause.json',
):
    old, new = source / relative, restored / relative
    a, b = old.lstat(), new.lstat()
    assert (a.st_uid, a.st_gid, a.st_mode) == (b.st_uid, b.st_gid, b.st_mode), relative
    if stat.S_ISLNK(a.st_mode):
        assert os.readlink(old) == os.readlink(new), relative
    elif stat.S_ISREG(a.st_mode):
        assert old.read_bytes() == new.read_bytes(), relative
    attrs = os.listxattr(old, follow_symlinks=False)
    if relative == 'etc/bc250-ai-studio.env':
        assert 'system.posix_acl_access' in attrs, '시험용 추가 ACL이 없습니다.'
    assert set(attrs) == set(os.listxattr(new, follow_symlinks=False)), relative
    for attr in attrs:
        assert os.getxattr(old, attr, follow_symlinks=False) == os.getxattr(
            new, attr, follow_symlinks=False
        ), (relative, attr)
assert Path(sys.argv[3]).read_bytes() == Path(sys.argv[4]).read_bytes()
print('시험 백업의 내용, 소유권, 권한, 링크와 확장 속성 복원 확인')
PY
echo '추가 ACL 복원 확인'
echo "시험 파일 보관: $fixture"
