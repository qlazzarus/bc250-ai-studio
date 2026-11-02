#!/usr/bin/env bash
# Exercise backup, relabel and restoration on a disposable VM fixture only.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test ]] || {
  echo '시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 QEMU 시험 VM이 아닙니다.' >&2; exit 1;
}
fixture=/opt/bc250-label-restore-test
backup=/var/backups/bc250-label-restore-test
for path in "$fixture" "$backup"; do
  [[ ! -e "$path" && ! -L "$path" ]] || { echo "이미 존재합니다: $path" >&2; exit 1; }
done
install -d -o root -g root -m 0755 "$fixture"
install -d -o root -g root -m 0700 "$backup"
printf 'ACTIVE_MODEL=fake\n' > "$fixture/active-model.conf"
chmod 0640 "$fixture/active-model.conf"
restorecon -RF "$fixture" "$backup"
chcon -u unconfined_u "$fixture/active-model.conf"
cp -a "$fixture/active-model.conf" "$backup/active-model.conf"

cat > "$fixture/check.py" <<'PY'
import os
import stat
import sys
import tempfile
from pathlib import Path

path = Path('/opt/bc250-label-restore-test/active-model.conf')
expected = sys.argv[1] == 'same'

def protected(fd):
    names = set(os.listxattr(fd))
    return {name: os.getxattr(fd, name)
            for name in ('security.selinux', 'system.posix_acl_access') if name in names}

source = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
try:
    metadata = os.fstat(source)
    original = protected(source)
finally:
    os.close(source)
fd, temporary = tempfile.mkstemp(prefix='.label-check-', dir=path.parent)
try:
    try:
        os.fchown(fd, metadata.st_uid, metadata.st_gid)
        os.fchmod(fd, stat.S_IMODE(metadata.st_mode))
        replacement = protected(fd)
    finally:
        os.close(fd)
    assert (original == replacement) is expected
    print('작업자 임시 파일과 보호 속성 일치:', original == replacement)
finally:
    os.unlink(temporary)
PY
chmod 0644 "$fixture/check.py"
restorecon -F "$fixture/check.py"

run_check() {
  local expected=$1 result=0 unit="bc250-label-rollback-$2"
  systemd-run --wait --collect --unit="$unit" \
    -p User=root -p Group=root -p UMask=0077 -p NoNewPrivileges=yes \
    -p PrivateTmp=yes -p ProtectHome=yes -p ProtectSystem=strict \
    -p "ReadWritePaths=$fixture" -p CapabilityBoundingSet=CAP_CHOWN \
    /usr/bin/python3 -I "$fixture/check.py" "$expected" || result=$?
  journalctl -b -u "$unit" -n 20 --no-pager -o cat
  (( result == 0 )) || return "$result"
}

python3 - <<'PY'
import hashlib
import os
import stat
from pathlib import Path

def describe(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        names = set(os.listxattr(fd))
        attributes = {name: os.getxattr(fd, name)
                      for name in ('security.selinux', 'system.posix_acl_access') if name in names}
        with os.fdopen(os.dup(fd), 'rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        return info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode), attributes, digest
    finally:
        os.close(fd)

source = Path('/opt/bc250-label-restore-test/active-model.conf')
backup = Path('/var/backups/bc250-label-restore-test/active-model.conf')
assert describe(source) == describe(backup), '백업의 내용 또는 보호 속성이 다릅니다.'
print('시험 설정의 내용·소유권·권한·보호 속성 백업 확인')
PY

run_check different before
restorecon -F "$fixture/active-model.conf"
python3 - <<'PY'
import hashlib
import os
import stat
from pathlib import Path

def describe(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        names = set(os.listxattr(fd))
        acl = os.getxattr(fd, 'system.posix_acl_access') if 'system.posix_acl_access' in names else None
        label = os.getxattr(fd, 'security.selinux') if 'security.selinux' in names else None
        with os.fdopen(os.dup(fd), 'rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        return info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode), acl, label, digest
    finally:
        os.close(fd)

current = describe(Path('/opt/bc250-label-restore-test/active-model.conf'))
backup = describe(Path('/var/backups/bc250-label-restore-test/active-model.conf'))
assert current[:4] == backup[:4] and current[5] == backup[5]
assert current[4] != backup[4]
print('레이블 교정 후 내용·소유권·권한·ACL 유지 확인')
PY
run_check same normalized

# Restore the entire backed-up test file by a same-directory atomic replacement.
cp -a "$backup/active-model.conf" "$fixture/.restore-test"
python3 - <<'PY'
import hashlib
import os
import stat
from pathlib import Path

def describe(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        names = set(os.listxattr(fd))
        attributes = {name: os.getxattr(fd, name)
                      for name in ('security.selinux', 'system.posix_acl_access') if name in names}
        with os.fdopen(os.dup(fd), 'rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        return info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode), attributes, digest
    finally:
        os.close(fd)

fixture = Path('/opt/bc250-label-restore-test')
backup = Path('/var/backups/bc250-label-restore-test/active-model.conf')
temporary = fixture / '.restore-test'
assert describe(temporary) == describe(backup), '복원 후보의 보호 속성이 다릅니다.'
with temporary.open('rb') as stream:
    os.fsync(stream.fileno())
os.replace(temporary, fixture / 'active-model.conf')
directory = os.open(fixture, os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(directory)
finally:
    os.close(directory)
assert describe(fixture / 'active-model.conf') == describe(backup)
print('시험 설정의 내용·소유권·권한·보호 속성 원자적 복원 확인')
PY
run_check different restored
echo "시험 완료. 시험 백업은 보존했습니다: $backup"
