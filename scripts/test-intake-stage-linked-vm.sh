#!/usr/bin/env bash
# Use a real signed candidate with simulated runner-to-server authorization.
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
upload=$(mktemp -d /var/lib/bc250-intake-linked.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-intake-linked.XXXXXXXX)
stage=$(mktemp -d /opt/bc250-release.XXXXXXXX)
rmdir "$stage"
trap 'echo "시험 중단. 시험 파일 보관: $upload $records $stage" >&2' ERR
chown vmtest:vmtest "$upload"
install -o vmtest -g vmtest -m 0600 "$fixture/offline-candidate.tar.gz" "$upload/candidate.tar.gz"
install -d -o root -g root -m 0700 "$records/incoming"
restorecon -RF "$upload" "$records"
unshare --net -- /usr/bin/env -i HOME="$tools/home" PATH=/usr/bin:/bin \
  /usr/bin/python3 - "$source_dir" "$fixture" "$tools" "$upload" "$records" "$stage" <<'PY'
import hashlib
import importlib.util
import os
import pwd
import sys
import tarfile
from pathlib import Path
source, fixture, tools, upload, records, target = map(Path, sys.argv[1:])
if os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net'):
    raise SystemExit('별도 시험 네트워크 네임스페이스가 아닙니다.')
sys.dont_write_bytecode = True
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
base = source/'deploy/model-control'
intake = load('fixture_intake', base/'intake-authenticated-artifact.py')
offline = load('fixture_offline', base/'offline-attestation-check.py')
stager = load('fixture_stage', base/'stage-release.py')
verifier = load('fixture_archive', base/'verify-release-candidate.py')
tree = load('fixture_tree', base/'verify-staged-release.py')
pinned = load('fixture_pinned', base/'assemble-pinned-coordinator.py')
commit = 'cc55bb9873b8884410606491e390b76c397f2e5e'
digest = 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8'
run_id, attempt = '41945044035', '1'
pins = dict(gh='b768184570b12536be4ac1528893f6340d1c6a7b40b56ad45bca9cd0e87ad34d',
            verifier='f5b40b76df2e723b85be7443df30701d91d201765ba225432c5169c3c7ab8c24',
            artifact=digest, bundle='3c828832941a65f61eb2fdffa8cd54c9c50ab503b1df143fc969f18f6bd308b9',
            trusted_root='65ca537f6ed8a47fd0e560c421baa1f6c1efb8b25fc200d8c5c02c0e92eb2b9c')
check = offline.OfflineAttestationCheck(
    gh=fixture/'gh', verifier=tools/'verifier.py', artifact=fixture/'offline-candidate.tar.gz',
    bundle=fixture/'offline-bundle.jsonl', trusted_root=fixture/'offline-trusted-root.jsonl',
    home=tools/'home', commit=commit, digest=digest, run_id=run_id, attempt=attempt, pins=pins)
if check(commit, digest) is not True:
    raise SystemExit('시험 후보 서명 검사 실패')
# This models the runner's verified identity being delivered to a trusted receiver;
# it deliberately does not simulate or authenticate SSH itself.
receipt = (commit, digest, run_id, attempt)
def authorize(revision, value, run, trial):
    return (revision, value, run, trial) == receipt
archive = intake.receive(upload/'candidate.tar.gz', records/'incoming', owner=pwd.getpwnam('vmtest').pw_uid,
    commit=commit, digest=digest, run_id=run_id, attempt=attempt, verify_authorization=authorize)
print('실제 시험 후보의 서명 확인 후 모의 전달 승인을 통한 root 수신 확인', flush=True)
def verify_archive(path, value, revision):
    verifier.verify(path, value, revision)
    return True
def verify_stage(path, revision, value):
    return tree.StagedReleaseCheck(archive, path, revision, value)(revision, value)
stager.stage(archive, target, commit, digest, verify_archive=verify_archive, verify_stage=verify_stage)
bootstrap_name = 'deploy/model-control/verify-staged-release.py'
with tarfile.open(archive, 'r:gz') as tar:
    with tar.extractfile(bootstrap_name) as stream:
        bootstrap_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
checker = pinned.authenticated_checker(root=target, archive=archive,
    bootstrap_checker=target/bootstrap_name, bootstrap_sha256=bootstrap_hash,
    commit=commit, artifact_sha256=digest,
    verify_provenance=lambda revision, value: authorize(revision, value, run_id, attempt))
if checker(commit, digest) is not True:
    raise SystemExit('수신된 시험 후보의 릴리스 검사 실패')
print('root 수신 후보의 실제 스테이징·릴리스 조립 검사 연결 확인', flush=True)
print('승인 전달·SSH 인증·실제 운영 서비스·설치는 모의 또는 시험 범위 밖입니다.', flush=True)
PY
trap - ERR
echo "시험 파일 보관: $upload $records $stage"
