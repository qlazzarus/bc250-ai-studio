#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
evidence=$(mktemp -d /etc/bc250-test-secrets.XXXXXXXX)
trap 'echo "시험 중단. 시험 설정을 보관합니다: $evidence" >&2' ERR
python3 - "$source_dir" "$evidence" <<'PY'
import importlib.util
import os
import sys
from pathlib import Path

source, evidence = map(Path, sys.argv[1:])
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
prepare = load('prepare', source / 'deploy/model-control/prepare-secrets.py')
verify = load('verify', source / 'deploy/model-control/verify-staged-secrets.py')
prepare.DIRECTORY = verify.DIRECTORY = evidence / 'credentials'
prepare.main()
verify.main()
keyfile = verify.DIRECTORY / 'client-gate.env'
original = keyfile.read_bytes()
prefix = b'LLM_GATE_API_KEY='
assert original.startswith(prefix) and len(original) == len(prefix) + 65
replacement = b'0' if original[len(prefix):len(prefix) + 1] != b'0' else b'1'
keyfile.write_bytes(original[:len(prefix)] + replacement + original[len(prefix) + 1:])
try:
    verify.main()
except ValueError:
    print('시험 Client 키 불일치 거절 확인', flush=True)
else:
    raise SystemExit('다른 Client 키를 허용했습니다.')
keyfile.write_bytes(original)
os.chmod(keyfile, 0o644)
try:
    verify.main()
except ValueError:
    print('시험 설정 파일의 느슨한 권한 거절 확인', flush=True)
else:
    raise SystemExit('느슨한 파일 권한을 허용했습니다.')
os.chmod(keyfile, 0o600)
verify.main()
PY
echo "시험 설정 보관: $evidence"
