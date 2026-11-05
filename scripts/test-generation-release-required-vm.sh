#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
python3 "$1/scripts/test-generation-release-required.py"
echo '시험 릴리스에 세대 검사 파일 각각이 없을 때 거절 확인'
bash "$1/scripts/test-staged-release-vm.sh" "$1"
echo '아티팩트 구성 검사만 확인했습니다. 실제 배포·운영 서비스는 변경하지 않았습니다.'
