#!/usr/bin/env bash
# Test only rejection paths; never stop services or create an operational backup.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/backup-stopped.sh ]] || exit 1
fixture=$(mktemp -d /var/backups/bc250-backup-path-test.XXXXXXXX)
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture" >&2' ERR
install -d -m 0700 "$fixture/trusted" "$fixture/untrusted"
install -m 0700 "$1/deploy/model-control/backup-stopped.sh" "$fixture/trusted/backup-stopped.sh"
install -m 0600 "$1/deploy/model-control/backup-archive.sh" "$fixture/trusted/backup-archive.sh"
printf 'test fixture\n' > "$fixture/trusted/Caddyfile"
chmod 0600 "$fixture/trusted/Caddyfile"
cp -a "$fixture/trusted/Caddyfile" "$fixture/untrusted/Caddyfile"
chmod 0777 "$fixture/untrusted"

expect_rejected() {
  local output
  if output=$(bash "$1" "$2" 2>&1); then
    echo '신뢰할 수 없는 경로가 허용됐습니다.' >&2; exit 1
  fi
  [[ $output == *'신뢰할 수 없는 소유권 또는 경로 권한입니다.'* ]] || {
    echo '예상한 경로 검사에서 거절되지 않았습니다.' >&2; exit 1;
  }
}
expect_rejected "$fixture/trusted/backup-stopped.sh" "$fixture/untrusted/Caddyfile"
install -m 0700 "$fixture/trusted/backup-stopped.sh" "$fixture/untrusted/backup-stopped.sh"
install -m 0600 "$fixture/trusted/backup-archive.sh" "$fixture/untrusted/backup-archive.sh"
expect_rejected "$fixture/untrusted/backup-stopped.sh" "$fixture/trusted/Caddyfile"
echo 'Caddyfile과 백업 함수의 쓰기 가능한 상위 경로 거절 확인'
echo "시험 파일 보관: $fixture"
