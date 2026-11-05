#!/usr/bin/env bash
# Exercise staging with the downloaded signed candidate in a disposable VM only.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
records=$(mktemp -d /var/backups/bc250-attested-stage.XXXXXXXX)
stage=$(mktemp -d /opt/bc250-release.XXXXXXXX)
rmdir "$stage"
trap 'echo "시험 중단. 시험 후보·기록 보관: $stage $records" >&2' ERR
install -o root -g root -m 0600 "$source_dir/attested-candidate.tar.gz" "$records/candidate.tar.gz"
restorecon -RF "$records"
python3 - "$source_dir" "$records/candidate.tar.gz" "$stage" <<'PY'
import importlib.util
import sys
from pathlib import Path

source, archive, target = map(Path, sys.argv[1:])
commit = 'cc55bb9873b8884410606491e390b76c397f2e5e'
digest = 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8'
sys.dont_write_bytecode = True
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
base = source / 'deploy/model-control'
stager = load('stage', base / 'stage-release.py')
archive_check = load('archive_check', base / 'verify-release-candidate.py')
tree = load('staged_check', base / 'verify-staged-release.py')
def verify_archive(path, expected, revision):
    archive_check.verify(path, expected, revision)
    return True
def verify_stage(path, revision, expected):
    return tree.StagedReleaseCheck(archive, path, revision, expected)(revision, expected)
stager.stage(archive, target, commit, digest, verify_archive=verify_archive, verify_stage=verify_stage)
if tree.StagedReleaseCheck(archive, target, commit, digest)(commit, digest) is not True:
    raise SystemExit('실제 후보 트리 검사 실패')
print('Actions 후보 tar·커밋·해시 및 시험 VM 스테이징 트리 일치 확인', flush=True)
item = target / 'backend/app/main.py'
with item.open('ab') as output:
    output.write(b'\n# isolated fixture modification\n')
try:
    tree.StagedReleaseCheck(archive, target, commit, digest)(commit, digest)
except ValueError:
    print('시험 스테이징 파일 변조 거절 확인', flush=True)
else:
    raise SystemExit('변경된 시험 트리가 허용됐습니다.')
print('VM 검사 도구는 시험 소스이며 VM 자체의 서명 검증·root 신뢰와 운영 설치는 범위 밖입니다.', flush=True)
PY
trap - ERR
echo "시험 후보·기록 보관: $stage $records"
