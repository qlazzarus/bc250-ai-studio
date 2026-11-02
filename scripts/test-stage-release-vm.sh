#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
tools=$(mktemp -d /opt/bc250-stage-tools.XXXXXXXX)
evidence=$(mktemp -d /var/backups/bc250-stage-release-test.XXXXXXXX)
trap 'echo "시험 중단. 시험 도구와 기록을 보존합니다: $tools $evidence" >&2' ERR
for name in stage-release.py verify-staged-release.py verify-release-candidate.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$tools/$name"
done
restorecon -RF "$tools"
python3 - "$tools" "$evidence" <<'PY'
import hashlib
import importlib.util
import io
import secrets
import string
import tarfile
import sys
from pathlib import Path

tools, evidence = map(Path, sys.argv[1:])
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
stage = load('stage', tools / 'stage-release.py')
tree = load('tree', tools / 'verify-staged-release.py')
verifier = load('verifier', tools / 'verify-release-candidate.py')
commit = 'a' * 40
archive_path = evidence / 'candidate.tar.gz'
with tarfile.open(archive_path, 'w:gz') as archive:
    for name in sorted(verifier.REQUIRED):
        data = ((commit + '\n').encode() if name == 'COMMIT' else
                (tools / 'verify-release-candidate.py').read_bytes() if name == tree.VERIFIER else b'fixture\n')
        item = tarfile.TarInfo(name)
        item.size = len(data)
        archive.addfile(item, io.BytesIO(data))
digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
def destination():
    alphabet = string.ascii_letters + string.digits
    return Path('/opt/bc250-release.' + ''.join(secrets.choice(alphabet) for _ in range(8)))
def verify_archive(path, value, revision):
    verifier.verify(path, value, revision)
    return True
def verify_stage(path, revision, value):
    return tree.StagedReleaseCheck(archive_path, path, revision, value)(revision, value)
bad_target = destination()
wrong = ('0' if digest[0] != '0' else '1') + digest[1:]
try:
    stage.stage(archive_path, bad_target, commit, wrong, verify_archive=verify_archive, verify_stage=verify_stage)
except ValueError:
    pass
else:
    raise SystemExit('다른 아티팩트 해시를 허용했습니다.')
if bad_target.exists():
    raise SystemExit('아티팩트 검증 전 대상이 생성됐습니다.')
print('시험 아티팩트 해시 오류는 디렉터리 생성 전 거절 확인', flush=True)
target = destination()
stage.stage(archive_path, target, commit, digest, verify_archive=verify_archive, verify_stage=verify_stage)
if not (target / 'backend/app/main.py').is_file():
    raise SystemExit('시험 릴리스 파일이 없습니다.')
print('시험 릴리스 안전 스테이징과 아티팩트·트리 일치 확인', flush=True)
try:
    stage.stage(archive_path, target, commit, digest, verify_archive=verify_archive, verify_stage=verify_stage)
except ValueError:
    print('기존 시험 릴리스 경로 덮어쓰기 거절 확인', flush=True)
else:
    raise SystemExit('기존 릴리스를 덮어쓰도록 허용했습니다.')
partial = destination()
try:
    stage.stage(archive_path, partial, commit, digest, verify_archive=verify_archive,
                verify_stage=lambda *_: False)
except ValueError:
    pass
else:
    raise SystemExit('시험 트리 검증 실패를 잘못 허용했습니다.')
if not (partial / 'COMMIT').is_file():
    raise SystemExit('시험 실패 시 부분 트리가 보존되지 않았습니다.')
print('시험 최종 검증 실패 시 부분 트리 보존 확인:', partial, flush=True)
print('시험 릴리스 보관:', target, flush=True)
PY
echo "시험 아티팩트와 도구 보관: $evidence $tools"
