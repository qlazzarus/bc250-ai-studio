#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
python3 "$1/scripts/test-studio-process-observer.py"
echo '시험 프로세스의 실행 파일·인자·작업 디렉터리·UID와 불일치 거절 확인'
echo '실제 Studio의 로드된 코드·서비스 전체·GPU와 직접 호출 차단은 시험하지 않았습니다.'
