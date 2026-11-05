#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
python3 "$1/scripts/test-old-studio-process-watch.py"
echo '시험 주 프로세스의 pidfd 종료 감지와 새 프로세스 실행 중 기존 종료 확인'
echo '단일 시험 프로세스만 확인했습니다. cgroup 전체 종료·GPU·직접 호출 차단은 시험하지 않았습니다.'
