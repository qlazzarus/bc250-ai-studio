#!/usr/bin/env bash
# Combine service guard, backup, damage and fixture-only restoration in the VM.
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
original=/var/tmp/bc250-backup-archive-test.jHO1rD8O
[[ -f $original/source/etc/bc250-ai-studio.env && -f $original/Caddyfile.original ]] || {
  echo '이전 백업 시험 자료가 없습니다.' >&2; exit 1;
}
unit=bc250-backup-rollback-fixture.service
unit_path=/run/systemd/system/$unit
[[ ! -e $unit_path && ! -e /etc/systemd/system/$unit ]] || exit 1
fixture=$(mktemp -d /var/tmp/bc250-backup-rollback.XXXXXXXX)
backup=$(mktemp -d /var/backups/bc250-rollback-input.XXXXXXXX)
trap 'echo "시험 중단. 시험 unit과 자료를 보존합니다: $fixture $backup" >&2' ERR
cp -a "$original/source" "$fixture/live"
cp -a "$original/Caddyfile.original" "$fixture/Caddyfile.original"
cat > "$unit_path" <<'EOF'
[Service]
Type=simple
ExecStart=/usr/bin/sleep 600
KillMode=control-group
EOF
systemctl daemon-reload
systemctl start "$unit"
if bc250_require_stopped "$unit"; then
  echo '실행 중인 시험 서비스를 잘못 허용했습니다.' >&2; exit 1
fi
systemctl stop "$unit"
bc250_require_stopped "$unit"
bc250_backup_archive "$fixture/live" "$backup" "$fixture/Caddyfile.original"
echo '시험 서비스 정지 후 코드·데이터·상태 함께 백업 완료'
printf '시험용 변경된 코드\n' > "$fixture/live/opt/bc250-ai-studio/backend/main.py"
printf '시험용 변경된 데이터\n' > "$fixture/live/opt/ai-studio-data/data.db"
output=$(bash "$1/deploy/model-control/restore-backup-to-stage.sh" "$backup")
printf '%s\n' "$output"
stage=$(printf '%s\n' "$output" | sed -n 's/^복원 확인 경로: //p')
[[ $stage == /var/backups/bc250-restore-stage.* && -d $stage/files ]] || exit 1
bc250_require_stopped "$unit"
# Only paths under the private disposable fixture are replaced.
mv "$fixture/live/opt/bc250-ai-studio" "$fixture/changed-code"
mv "$fixture/live/opt/ai-studio-data" "$fixture/changed-data"
cp -a "$stage/files/opt/bc250-ai-studio" "$fixture/live/opt/"
cp -a "$stage/files/opt/ai-studio-data" "$fixture/live/opt/"
python3 - "$original/source" "$fixture/live" <<'PY'
import os
import sys
from pathlib import Path

old, new = map(Path, sys.argv[1:])
for name in ('opt/bc250-ai-studio/backend/main.py', 'opt/ai-studio-data/data.db'):
    left, right = old / name, new / name
    assert left.read_bytes() == right.read_bytes(), name
    assert (left.stat().st_uid, left.stat().st_gid, left.stat().st_mode) == (
        right.stat().st_uid, right.stat().st_gid, right.stat().st_mode), name
    for attr in os.listxattr(left):
        assert os.getxattr(left, attr) == os.getxattr(right, attr), (name, attr)
assert (new / 'var/lib/bc250-model-control/legacy-pause.json').read_text() == (
    old / 'var/lib/bc250-model-control/legacy-pause.json').read_text()
print('시험 코드·데이터 복원 및 기존 pause 기록 유지 확인')
PY
rm -- "$unit_path"
systemctl daemon-reload
echo "시험 결과 보관: $fixture $backup $stage"
