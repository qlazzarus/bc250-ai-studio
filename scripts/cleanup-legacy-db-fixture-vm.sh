#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $# == 0 ]] || exit 1
unit=/run/systemd/system/bc250-legacy-db-fixture.service
[[ -f $unit && ! -L $unit && ! -e /etc/systemd/system/${unit##*/} ]] || exit 1
cmp -s "$unit" <(printf '[Service]\nExecStart=/usr/bin/sleep infinity\nKillMode=control-group\n') || {
  echo '시험 unit 내용이 예상과 달라 정리하지 않았습니다.' >&2; exit 1;
}
systemctl stop "${unit##*/}"
rm -- "$unit"
systemctl daemon-reload
echo '시험 unit 정리 완료. 시험 DB와 실패 기록은 보존합니다.'
