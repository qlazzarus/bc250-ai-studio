#!/usr/bin/env bash
# Isolated VM integration: actual offline signature and actual staged candidate.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=/opt/bc250-offline-attestation.qgDxK0GX
tools=/opt/bc250-trusted-offline.cljYhzEX
for path in "$fixture" "$tools"; do
  [[ -d $path && ! -L $path && $(stat -c %u "$path") == 0 ]] || exit 1
done
stage=$(mktemp -d /opt/bc250-release.XXXXXXXX)
rmdir "$stage"
trap 'echo "시험 중단. 시험 스테이징과 기존 자료 보관: $stage $fixture $tools" >&2' ERR
unshare --net -- /usr/bin/env -i HOME="$tools/home" PATH=/usr/bin:/bin \
  /usr/bin/python3 - "$source_dir" "$fixture" "$tools" "$stage" <<'PY'
import hashlib
import importlib.util
import os
import sys
import tarfile
from pathlib import Path
source, fixture, tools, target = map(Path, sys.argv[1:])
if os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net'):
    raise SystemExit('별도 시험 네트워크 네임스페이스가 아닙니다.')
sys.dont_write_bytecode = True
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
base = source / 'deploy/model-control'
pinned = load('pinned_coordinator', base / 'assemble-pinned-coordinator.py')
offline = load('offline_check', base / 'offline-attestation-check.py')
stager = load('stager', base / 'stage-release.py')
verifier = load('archive_verifier', base / 'verify-release-candidate.py')
tree = load('tree_verifier', base / 'verify-staged-release.py')
commit = 'cc55bb9873b8884410606491e390b76c397f2e5e'
digest = 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8'
archive = fixture / 'offline-candidate.tar.gz'
pins = dict(gh='b768184570b12536be4ac1528893f6340d1c6a7b40b56ad45bca9cd0e87ad34d',
            verifier='f5b40b76df2e723b85be7443df30701d91d201765ba225432c5169c3c7ab8c24',
            artifact=digest, bundle='3c828832941a65f61eb2fdffa8cd54c9c50ab503b1df143fc969f18f6bd308b9',
            trusted_root='65ca537f6ed8a47fd0e560c421baa1f6c1efb8b25fc200d8c5c02c0e92eb2b9c')
provenance = offline.OfflineAttestationCheck(
    gh=fixture/'gh', verifier=tools/'verifier.py', artifact=archive,
    bundle=fixture/'offline-bundle.jsonl', trusted_root=fixture/'offline-trusted-root.jsonl',
    home=tools/'home', commit=commit, digest=digest, run_id='41945044035', attempt='1', pins=pins)
if provenance(commit, digest) is not True:
    raise SystemExit('시험 출처 검사 실패')
def verify_archive(path, expected, revision):
    verifier.verify(path, expected, revision)
    return True
def verify_stage(path, revision, expected):
    return tree.StagedReleaseCheck(archive, path, revision, expected)(revision, expected)
stager.stage(archive, target, commit, digest, verify_archive=verify_archive, verify_stage=verify_stage)
bootstrap_name = 'deploy/model-control/verify-staged-release.py'
with tarfile.open(archive, 'r:gz') as tar:
    with tar.extractfile(bootstrap_name) as file:
        bootstrap_hash = hashlib.file_digest(file, 'sha256').hexdigest()
checker = pinned.authenticated_checker(root=target, archive=archive,
    bootstrap_checker=target/bootstrap_name, bootstrap_sha256=bootstrap_hash,
    commit=commit, artifact_sha256=digest, verify_provenance=provenance)
if checker(commit, digest) is not True:
    raise SystemExit('시험 조립 후보 검증 실패')
print('실제 오프라인 출처·고정 검사기·스테이징 검사를 릴리스 조립 후보에 연결 확인', flush=True)
item = target/'backend/app/main.py'
with item.open('ab') as file:
    file.write(b'\n# isolated fixture modification\n')
try:
    checker(commit, digest)
except ValueError:
    print('출처가 유효해도 조립 후보의 변조된 시험 트리 거절 확인', flush=True)
else:
    raise SystemExit('변조된 시험 트리가 허용됐습니다.')
PY
trap - ERR
echo "시험 스테이징 보관: $stage"
echo '시험 고정값·검사 도구는 사용자 전달 자료이며 운영 독립 신뢰·배포 승인·서비스 변경은 범위 밖입니다.'
