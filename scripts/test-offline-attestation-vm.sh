#!/usr/bin/env bash
# Disposable QEMU VM only: no external network in the verification namespace.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=$(mktemp -d /opt/bc250-offline-attestation.XXXXXXXX)
trap 'echo "시험 중단. 시험 자료 보관: $fixture" >&2' ERR
install -m 0755 "$source_dir/offline-gh" "$fixture/gh"
for name in offline-candidate.tar.gz offline-bundle.jsonl offline-trusted-root.jsonl; do
  install -m 0600 "$source_dir/$name" "$fixture/$name"
done
install -m 0644 "$source_dir/scripts/verify-candidate-run.py" "$fixture/verify-candidate-run.py"
restorecon -RF "$fixture"
python3 - "$fixture" <<'PY'
import hashlib
import sys
from pathlib import Path
root = Path(sys.argv[1])
expected = {
    'gh': 'b768184570b12536be4ac1528893f6340d1c6a7b40b56ad45bca9cd0e87ad34d',
    'offline-candidate.tar.gz': 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8',
    'offline-bundle.jsonl': '3c828832941a65f61eb2fdffa8cd54c9c50ab503b1df143fc969f18f6bd308b9',
    'offline-trusted-root.jsonl': '65ca537f6ed8a47fd0e560c421baa1f6c1efb8b25fc200d8c5c02c0e92eb2b9c',
}
for name, digest in expected.items():
    with (root / name).open('rb') as file:
        if hashlib.file_digest(file, 'sha256').hexdigest() != digest:
            raise SystemExit('전달된 시험 검증 자료 해시 불일치')
print('시험 검증 도구·후보·bundle·신뢰 루트의 전달 해시 확인', flush=True)
PY
unshare --net -- /usr/bin/env -i HOME="$fixture" PATH=/usr/bin:/bin \
  /usr/bin/python3 - "$fixture" <<'PY'
import importlib.util
import os
import sys
from pathlib import Path
root = Path(sys.argv[1])
if os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net'):
    raise SystemExit('별도 시험 네트워크 네임스페이스가 아닙니다.')
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('run_verifier', root / 'verify-candidate-run.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
args = (root / 'gh', root / 'offline-candidate.tar.gz',
        'cc55bb9873b8884410606491e390b76c397f2e5e', '41945044035', '1')
kwargs = dict(bundle=root / 'offline-bundle.jsonl', trusted_root=root / 'offline-trusted-root.jsonl')
if module.verify(*args, **kwargs) != 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8':
    raise SystemExit('시험 후보 검증 결과 해시 불일치')
print('격리 네트워크에서 저장된 bundle·신뢰 루트로 실제 후보 서명과 실행 확인', flush=True)
try:
    module.verify(*args[:3], '41945044036', args[4], **kwargs)
except ValueError as exc:
    if '실행 ID' not in str(exc):
        raise
    print('격리 네트워크에서 다른 실행 ID 거절 확인', flush=True)
else:
    raise SystemExit('다른 실행 ID가 허용됐습니다.')
PY
trap - ERR
echo "시험 자료 보관: $fixture"
echo '시험 검증 도구와 신뢰 루트는 사용자 전달 자료이며 운영 환경의 독립 신뢰나 배포 승인이 아닙니다.'
