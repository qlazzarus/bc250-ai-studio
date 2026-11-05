#!/usr/bin/env bash
# Isolated test VM only. Pins below are test inputs, not operating trust anchors.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=/opt/bc250-offline-attestation.qgDxK0GX
[[ -d $fixture && ! -L $fixture && $(stat -c %u "$fixture") == 0 ]] || exit 1
tools=$(mktemp -d /opt/bc250-trusted-offline.XXXXXXXX)
trap 'echo "시험 중단. 시험 도구 보관: $tools; 기존 자료: $fixture" >&2' ERR
install -o root -g root -m 0644 "$source_dir/scripts/verify-candidate-run.py" "$tools/verifier.py"
install -d -o root -g root -m 0700 "$tools/home"
restorecon -RF "$tools"
unshare --net -- /usr/bin/env -i HOME="$tools/home" PATH=/usr/bin:/bin \
  /usr/bin/python3 - "$source_dir" "$fixture" "$tools" <<'PY'
import importlib.util
import os
import sys
from pathlib import Path
source, fixture, tools = map(Path, sys.argv[1:])
if os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net'):
    raise SystemExit('별도 시험 네트워크 네임스페이스가 아닙니다.')
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('offline_check', source / 'deploy/model-control/offline-attestation-check.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
commit = 'cc55bb9873b8884410606491e390b76c397f2e5e'
digest = 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8'
pins = dict(gh='b768184570b12536be4ac1528893f6340d1c6a7b40b56ad45bca9cd0e87ad34d',
            verifier='f5b40b76df2e723b85be7443df30701d91d201765ba225432c5169c3c7ab8c24',
            artifact=digest, bundle='3c828832941a65f61eb2fdffa8cd54c9c50ab503b1df143fc969f18f6bd308b9',
            trusted_root='65ca537f6ed8a47fd0e560c421baa1f6c1efb8b25fc200d8c5c02c0e92eb2b9c')
options = dict(gh=fixture/'gh', verifier=tools/'verifier.py', artifact=fixture/'offline-candidate.tar.gz',
               bundle=fixture/'offline-bundle.jsonl', trusted_root=fixture/'offline-trusted-root.jsonl',
               home=tools/'home', commit=commit, digest=digest, run_id='41945044035', attempt='1', pins=pins)
checker = module.OfflineAttestationCheck(**options)
if checker(commit, digest) is not True:
    raise SystemExit('시험 root 경로 검증 실패')
print('격리 네트워크에서 root 소유 도구·자료의 고정 해시와 실제 후보 출처 확인', flush=True)
wrong = dict(pins, gh='0'*64)
try:
    module.OfflineAttestationCheck(**dict(options, pins=wrong))(commit, digest)
except ValueError as exc:
    if '해시' not in str(exc): raise
    print('검증 도구의 잘못된 시험 고정 해시 거절 확인', flush=True)
else:
    raise SystemExit('잘못된 시험 고정 해시가 허용됐습니다.')
verifier = tools / 'verifier.py'
os.chmod(verifier, 0o666)
try:
    checker(commit, digest)
except ValueError as exc:
    if '권한' not in str(exc): raise
    print('쓰기 가능한 시험 검증기 경로 거절 확인', flush=True)
else:
    raise SystemExit('쓰기 가능한 시험 검증기가 허용됐습니다.')
finally:
    os.chmod(verifier, 0o644)
PY
trap - ERR
echo "시험 도구 보관: $tools; 기존 시험 자료: $fixture"
echo '시험 고정값은 사용자 전달 자료의 값이며 운영 독립 신뢰나 배포 승인이 아닙니다.'
