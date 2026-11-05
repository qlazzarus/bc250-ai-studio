#!/usr/bin/env bash
# Candidate arrived via a separate scp to the test VM, not from production.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
records=$(mktemp -d /var/backups/bc250-intake-ssh.XXXXXXXX)
stage=$(mktemp -d /opt/bc250-release.XXXXXXXX)
rmdir "$stage"
trap 'echo "시험 중단. 시험 파일 보관: $source_dir/upload $records $stage" >&2' ERR
install -d -o root -g root -m 0700 "$records/incoming"
restorecon -RF "$records"
python3 - "$source_dir" "$records" "$stage" <<'PY'
import hashlib
import importlib.util
import pwd
import sys
import tarfile
from pathlib import Path
source, records, target = map(Path, sys.argv[1:])
sys.dont_write_bytecode = True
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
base = source/'deploy/model-control'
intake = load('fixture_intake', base/'intake-authenticated-artifact.py')
stager = load('fixture_stage', base/'stage-release.py')
verifier = load('fixture_archive', base/'verify-release-candidate.py')
tree = load('fixture_tree', base/'verify-staged-release.py')
pinned = load('fixture_pinned', base/'assemble-pinned-coordinator.py')
commit = 'cc55bb9873b8884410606491e390b76c397f2e5e'
digest = 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8'
run_id, attempt = '41945044035', '1'
# This receipt is only a fixture, not SSH caller or Actions authorization.
receipt = (commit, digest, run_id, attempt)
def authorize(revision, value, run, trial):
    return (revision, value, run, trial) == receipt
archive = intake.receive(source/'upload/candidate.tar.gz', records/'incoming',
    owner=pwd.getpwnam('vmtest').pw_uid, commit=commit, digest=digest,
    run_id=run_id, attempt=attempt, verify_authorization=authorize)
print('별도 SSH 전송 시험 후보를 root 소유 경로에 수신 및 해시 일치 확인', flush=True)
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
    raise SystemExit('시험 후보의 릴리스 검사 실패')
print('SSH 전송 시험 후보의 실제 스테이징·릴리스 조립 검사 연결 확인', flush=True)
print('Actions 승인 전달·운영 SSH 권한 제한·서비스·설치는 시험하지 않았습니다.', flush=True)
PY
trap - ERR
echo "시험 파일 보관: $source_dir/upload $records $stage"
