#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
python3 "$1/scripts/test-startup-phase-checks.py"
python3 "$1/scripts/test-assemble-phase-safety.py"
python3 "$1/scripts/test-generation-bound-startup.py"
echo '시험 시작 전·시작 후 안전 검사 분리와 Wiki 차단 확인 순서 검증 완료'
echo '시험 기존 세대 정지·설치·신규 세대 확인 연결과 실패 시 재사용 거절 확인'
echo '서비스·GPU·직접 호출·신규 세대 안전 검사기는 모의이며 운영 서비스는 변경하지 않았습니다.'
