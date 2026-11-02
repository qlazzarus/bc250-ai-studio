#!/usr/bin/env bash
# Verify the archive fixture produced by the preceding backup ACL test.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/verify-backup.py ]] || exit 1
fixture=/var/tmp/bc250-backup-archive-test.jHO1rD8O/backup
[[ -f $fixture/legacy.tar && -f $fixture/SHA256SUMS && -f $fixture/Caddyfile.original ]] || {
  echo '이전 ACL 백업 시험 파일을 찾지 못했습니다.' >&2; exit 1;
}
backup=$(mktemp -d /var/backups/bc250-verify-fixture.XXXXXXXX)
trap 'echo "시험 파일을 보존합니다: $backup" >&2' ERR
cp -a "$fixture/." "$backup/"
chmod 0700 "$backup"
chmod 0600 "$backup/legacy.tar" "$backup/Caddyfile.original" "$backup/SHA256SUMS"
python3 "$1/deploy/model-control/verify-backup.py" "$backup"
printf 'fixture corruption\n' >> "$backup/Caddyfile.original"
if python3 "$1/deploy/model-control/verify-backup.py" "$backup"; then
  echo '변조된 백업을 잘못 허용했습니다.' >&2; exit 1
fi
echo '백업 내용 변경 시 체크섬 검증 거절 확인'
echo "시험 파일 보관: $backup"
