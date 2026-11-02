#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
tools=$(mktemp -d /opt/bc250-pinned-tools.XXXXXXXX)
fixture=$(mktemp -d /etc/bc250-pinned-fixture.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-pinned-record.XXXXXXXX)
snapshot=/var/backups/bc250-caddy-cycle-qhlsniyd/bc250-caddy-snapshot.lk3ka985
trap 'echo "시험 중단. 시험 도구와 기록 보관: $tools $fixture $records" >&2' ERR
[[ -d $snapshot && ! -L $snapshot && $(stat -c '%u %a' "$snapshot") == '0 700' ]] || exit 1
for name in assemble-pinned-coordinator.py stage-release.py verify-staged-release.py \
  verify-release-candidate.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$tools/$name"
done
restorecon -RF "$tools" "$fixture" "$records"
python3 - "$source_dir" "$tools" "$fixture" "$records" "$snapshot" <<'PY'
import hashlib
import importlib.util
import io
import json
import secrets
import string
import tarfile
import sys
from pathlib import Path

source, tools, fixture, records, snapshot = map(Path, sys.argv[1:])
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
stage = load('stage', tools / 'stage-release.py')
tree = load('tree', tools / 'verify-staged-release.py')
verifier = load('verifier', tools / 'verify-release-candidate.py')
pinned = load('pinned', tools / 'assemble-pinned-coordinator.py')
prepare = load('prepare', source / 'deploy/model-control/prepare-secrets.py')
prepare.DIRECTORY = fixture / 'credentials'
prepare.main()
target = Path('/opt/bc250-release.' + ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(8)))
print('시험 릴리스 경로:', target, flush=True)
commit = 'a' * 40
archive_path = records / 'candidate.tar.gz'
wrapper = ('import importlib.util, sys\nfrom pathlib import Path\nsys.dont_write_bytecode = True\n'
    f's = importlib.util.spec_from_file_location("fixture_verifier", {str(target / "deploy/model-control/fixture-verifier.py")!r})\n'
    'm = importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\n'
    f'm.DIRECTORY = Path({str(prepare.DIRECTORY)!r})\nm.main()\n').encode()
contents = {}
for name in verifier.REQUIRED:
    path = source / name
    if name == 'COMMIT':
        contents[name] = (commit + '\n').encode()
    elif name == 'deploy/model-control/verify-staged-secrets.py':
        contents[name] = wrapper
    elif path.is_file():
        contents[name] = path.read_bytes()
    else:
        contents[name] = b'fixture\n'
contents['deploy/model-control/fixture-verifier.py'] = (source / 'deploy/model-control/verify-staged-secrets.py').read_bytes()
with tarfile.open(archive_path, 'w:gz') as archive:
    for name, data in sorted(contents.items()):
        item = tarfile.TarInfo(name)
        item.size = len(data)
        archive.addfile(item, io.BytesIO(data))
digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
def verify_archive(path, value, revision):
    verifier.verify(path, value, revision)
    return True
def verify_stage(path, revision, value):
    return tree.StagedReleaseCheck(archive_path, path, revision, value)(revision, value)
stage.stage(archive_path, target, commit, digest, verify_archive=verify_archive, verify_stage=verify_stage)
bootstrap = tools / 'verify-staged-release.py'
bootstrap_hash = hashlib.sha256(bootstrap.read_bytes()).hexdigest()
good_record = records / 'good'
bad_record = records / 'bad'
good_record.mkdir(mode=0o700)
bad_record.mkdir(mode=0o700)
def args(directory, bootstrap_digest):
    return dict(root=target, archive=archive_path, bootstrap_checker=bootstrap,
        bootstrap_sha256=bootstrap_digest, snapshot=snapshot, journal_dir=directory,
        commit=commit, artifact_sha256=digest, expected_client_user='vmtest',
        preflight=lambda: True, check_local_idle=lambda: True, check_restored=lambda: True,
        install=lambda _: True, verify_new=lambda: True, verify_restored=lambda: True)
wrong = ('0' if bootstrap_hash[0] != '0' else '1') + bootstrap_hash[1:]
try:
    pinned.assemble(**args(bad_record, wrong))
except ValueError:
    pass
else:
    raise SystemExit('잘못된 부트스트랩 해시를 허용했습니다.')
if (bad_record / 'migration-events.jsonl').exists():
    raise SystemExit('검사기 거절 전 배포 기록이 생성됐습니다.')
print('시험 부트스트랩 해시 오류를 배포 기록 전 거절 확인', flush=True)
runner, journal = pinned.assemble(**args(good_record, bootstrap_hash))
try:
    if runner.runner.preflight() is not True or runner.phase != 'new':
        raise SystemExit('시험 릴리스 사전 검증에 실패했습니다.')
    rows = [json.loads(line) for line in (good_record / 'migration-events.jsonl').read_text().splitlines()]
    if len(rows) != 1 or rows[0].get('event') != 'release' or rows[0].get('sha256') != digest:
        raise SystemExit('시험 릴리스 기록이 올바르지 않습니다.')
    print('인증된 시험 아티팩트·스테이징 트리·조율 후보 연결 확인', flush=True)
    path = target / 'backend/app/main.py'
    path.write_bytes(path.read_bytes() + b'\n# fixture tamper\n')
    try:
        runner.runner.preflight()
    except ValueError:
        pass
    else:
        raise SystemExit('변조된 시험 릴리스를 허용했습니다.')
    if runner.phase != 'new':
        raise SystemExit('검증 실패 중 배포 단계가 변경됐습니다.')
    print('시험 릴리스 변조 시 배포 진입 전 거절 확인', flush=True)
finally:
    journal.close()
PY
echo "시험 도구와 기록 보관: $tools $fixture $records"
