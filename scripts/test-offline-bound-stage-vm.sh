#!/usr/bin/env bash
# Test real offline provenance against a real staged tree in the QEMU VM only.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
fixture=/opt/bc250-offline-attestation.qgDxK0GX
[[ -d $fixture && ! -L $fixture && $(stat -c %u "$fixture") == 0 ]] || {
  echo '기존 시험 검증 자료를 확인하지 못했습니다.' >&2; exit 1;
}
stage=$(mktemp -d /opt/bc250-release.XXXXXXXX)
rmdir "$stage"
trap 'echo "시험 중단. 시험 스테이징·기존 검증 자료 보관: $stage $fixture" >&2' ERR
unshare --net -- /usr/bin/env -i HOME="$fixture" PATH=/usr/bin:/bin \
  /usr/bin/python3 - "$source_dir" "$fixture" "$stage" <<'PY'
import importlib.util
import os
import sys
from pathlib import Path
source, fixture, target = map(Path, sys.argv[1:])
if os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net'):
    raise SystemExit('별도 시험 네트워크 네임스페이스가 아닙니다.')
sys.dont_write_bytecode = True
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
base = source / 'deploy/model-control'
attest = load('fixture_attestation', source / 'scripts/candidate-attestation-adapter.py')
pinned = load('fixture_pinned', base / 'assemble-pinned-coordinator.py')
stager = load('fixture_stager', base / 'stage-release.py')
archive_check = load('fixture_archive', base / 'verify-release-candidate.py')
tree = load('fixture_tree', base / 'verify-staged-release.py')
commit = 'cc55bb9873b8884410606491e390b76c397f2e5e'
digest = 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8'
archive = fixture / 'offline-candidate.tar.gz'
def make_provenance(run):
    return attest.AttestationCheck(fixture / 'gh', archive, commit, digest, run, '1',
        bundle=fixture / 'offline-bundle.jsonl', trusted_root=fixture / 'offline-trusted-root.jsonl')
checked = []
wrong = pinned.ProvenanceBoundCheck(lambda *_: checked.append('tree') or True, make_provenance('41945044036'))
try:
    wrong(commit, digest)
except ValueError as exc:
    if '실행 ID' not in str(exc):
        raise
else:
    raise SystemExit('다른 실행 ID가 허용됐습니다.')
if checked:
    raise SystemExit('잘못된 출처가 트리 검사에 도달했습니다.')
print('실제 서명에서 다른 실행 ID를 스테이징 전 거절 확인', flush=True)
def verify_archive(path, value, revision):
    archive_check.verify(path, value, revision)
    return True
def verify_stage(path, revision, value):
    return tree.StagedReleaseCheck(archive, path, revision, value)(revision, value)
stager.stage(archive, target, commit, digest, verify_archive=verify_archive, verify_stage=verify_stage)
checker = pinned.ProvenanceBoundCheck(tree.StagedReleaseCheck(archive, target, commit, digest),
                                       make_provenance('41945044035'))
if checker(commit, digest) is not True:
    raise SystemExit('실제 출처·트리 검증 실패')
print('격리 네트워크에서 실제 서명과 시험 VM 스테이징 트리 연결 확인', flush=True)
item = target / 'backend/app/main.py'
with item.open('ab') as file:
    file.write(b'\n# isolated fixture modification\n')
try:
    checker(commit, digest)
except ValueError:
    print('실제 출처가 유효해도 변조된 시험 트리 거절 확인', flush=True)
else:
    raise SystemExit('변조된 시험 트리가 허용됐습니다.')
PY
trap - ERR
echo "시험 스테이징·기존 검증 자료 보관: $stage $fixture"
echo '시험 도구·신뢰 루트는 별도 인증하지 않았으며 운영 배포·서비스는 변경하지 않았습니다.'
