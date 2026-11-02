#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
root=$(mktemp -d /opt/bc250-release-tree-test.XXXXXXXX)
evidence=$(mktemp -d /var/backups/bc250-release-tree-test.XXXXXXXX)
trap 'echo "시험 중단. 시험 파일 보관: $root $evidence" >&2' ERR
python3 - "$source_dir" "$root" "$evidence" <<'PY'
import hashlib
import importlib.util
import io
import os
import tarfile
import sys
from pathlib import Path

source, root, evidence = map(Path, sys.argv[1:])
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
base = source / 'deploy/model-control'
staged = load('staged', base / 'verify-staged-release.py')
verifier = load('verifier', base / 'verify-release-candidate.py')
commit = 'a' * 40
archive_path = evidence / 'candidate.tar.gz'
with tarfile.open(archive_path, 'w:gz') as archive:
    for name in sorted(verifier.REQUIRED):
        data = ((commit + '\n').encode() if name == 'COMMIT' else
                (base / 'verify-release-candidate.py').read_bytes() if name == staged.VERIFIER else b'fixture\n')
        item = root / name
        item.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        item.write_bytes(data)
        info = tarfile.TarInfo(name)
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
check = staged.StagedReleaseCheck(archive_path, root, commit, digest)
if check(commit, digest) is not True:
    raise SystemExit('시험 릴리스 검증에 실패했습니다.')
print('시험 아티팩트·커밋·root 소유 스테이징 트리 일치 확인', flush=True)
item = root / 'backend/app/main.py'
original = item.read_bytes()
item.write_bytes(b'changed\n')
try:
    check(commit, digest)
except ValueError:
    print('시험 스테이징 파일 변경 거절 확인', flush=True)
else:
    raise SystemExit('변경된 시험 파일을 허용했습니다.')
item.write_bytes(original)
extra = root / 'backend/app/unexpected.py'
extra.write_text('fixture\n')
try:
    check(commit, digest)
except ValueError:
    print('시험 릴리스 추가 파일 거절 확인', flush=True)
else:
    raise SystemExit('추가 시험 파일을 허용했습니다.')
extra.unlink()
os.chmod(item, 0o666)
try:
    check(commit, digest)
except ValueError:
    print('시험 릴리스 쓰기 권한 오류 거절 확인', flush=True)
else:
    raise SystemExit('느슨한 시험 파일 권한을 허용했습니다.')
os.chmod(item, 0o600)
if check(commit, digest) is not True:
    raise SystemExit('시험 릴리스 복원 확인에 실패했습니다.')
PY
echo "시험 아티팩트와 트리 보관: $evidence $root"
