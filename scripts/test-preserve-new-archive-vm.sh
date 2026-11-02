#!/usr/bin/env bash
# Exercise post-failure evidence archiving against disposable files only.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/preserve-new-archive.sh ]] || exit 1
source "$1/deploy/model-control/preserve-new-archive.sh"
fixture=$(mktemp -d /var/backups/bc250-new-evidence-test.XXXXXXXX)
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture" >&2' ERR
root=$fixture/source
evidence=$fixture/evidence
restored=$fixture/restored
mkdir -p "$root/var/lib/bc250-model-control" "$root/var/lib/bc250-llm-gate" \
  "$root/opt/ai-studio-data" "$root/etc/bc250-model-control" "$evidence" "$restored"
printf '{"phase":"fixture"}\n' > "$root/var/lib/bc250-model-control/switch.json"
printf '{"holds":["startup"]}\n' > "$root/var/lib/bc250-llm-gate/holds.json"
printf 'fixture changed data\n' > "$root/opt/ai-studio-data/data.db"
printf 'fixture wal bytes\n' > "$root/var/lib/bc250-model-control/operations.sqlite3-wal"
printf 'fixture-only-credential\n' > "$root/etc/bc250-model-control/api-key"
restorecon -RF "$root"
python3 - "$root/opt/ai-studio-data/data.db" <<'PY'
import os
import sys
os.setxattr(sys.argv[1], 'user.bc250-fixture', b'preserve')
PY
bc250_preserve_new_archive "$root" "$evidence"
tar --extract --file="$evidence/new-state.tar" --acls --xattrs --xattrs-include='*' \
  --selinux --numeric-owner --same-owner --same-permissions --directory="$restored"
python3 - "$root" "$restored" <<'PY'
import os
import sys
from pathlib import Path

source, restored = map(Path, sys.argv[1:])
for name in ('var/lib/bc250-model-control/switch.json', 'var/lib/bc250-llm-gate/holds.json',
             'var/lib/bc250-model-control/operations.sqlite3-wal', 'opt/ai-studio-data/data.db',
             'etc/bc250-model-control/api-key'):
    a, b = source / name, restored / name
    assert a.read_bytes() == b.read_bytes()
    sa, sb = a.stat(), b.stat()
    assert (sa.st_uid, sa.st_gid, sa.st_mode) == (sb.st_uid, sb.st_gid, sb.st_mode)
    attrs = set(os.listxattr(a))
    assert attrs == set(os.listxattr(b))
    for attr in attrs:
        assert os.getxattr(a, attr) == os.getxattr(b, attr)
assert os.getxattr(restored / 'opt/ai-studio-data/data.db', 'user.bc250-fixture') == b'preserve'
print('시험 journal·gate hold·WAL·변경 데이터·설정 및 보호 속성 보존 확인', flush=True)
PY
mkdir -m 0700 "$fixture/missing"
mv "$root/var/lib/bc250-model-control/switch.json" "$fixture/switch.fixture"
if bc250_preserve_new_archive "$root" "$fixture/missing"; then
  echo '시험 journal 누락을 잘못 허용했습니다.' >&2; exit 1
fi
[[ ! -e $fixture/missing/new-state.tar ]] || exit 1
echo '시험 journal 누락 시 아카이브 생성 전 중단 확인'
echo "시험 파일 보관: $fixture"
