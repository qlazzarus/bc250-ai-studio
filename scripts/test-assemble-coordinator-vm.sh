#!/usr/bin/env bash
# Construction and read-only preflight only; never invoke a deployment phase.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
release=$(mktemp -d /opt/bc250-assemble-test.XXXXXXXX)
fixture=$(mktemp -d /etc/bc250-assemble-test.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-assemble-test.XXXXXXXX)
snapshot=/var/backups/bc250-caddy-cycle-qhlsniyd/bc250-caddy-snapshot.lk3ka985
trap 'echo "시험 중단. 시험 파일과 기록을 보존합니다: $release $fixture $records" >&2' ERR
[[ -d $snapshot && ! -L $snapshot && $(stat -c '%u %a' "$snapshot") == '0 700' ]] || {
  echo '기존 시험 Caddy 보관본이 없습니다.' >&2; exit 1;
}
for name in assemble-coordinator.py caddy-maintenance-adapter.py capture-caddy.py \
  caddy-file-swap.py caddy-transaction.py maintenance-probe.py create-maintenance-caddy.py \
  legacy-backup-adapter.py legacy-backup-sequence.py migrate-legacy-gate.py \
  inspect-stopped-studio-db.py observe-llama-connections.py \
  backup-stopped.sh backup-archive.sh check-service-cgroup.py verify-backup.py \
  start-new-services.py staged-configuration-adapter.py migration-journal.py \
  coordinated-migration.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$release/$name"
done
install -o root -g root -m 0644 "$source_dir/deploy/model-control/verify-staged-secrets.py" "$release/actual-verifier.py"
restorecon -RF "$release" "$fixture" "$records"
python3 - "$source_dir" "$release" "$fixture" "$records" "$snapshot" <<'PY'
import hashlib
import importlib.util
from types import SimpleNamespace
import json
import subprocess
import sys
from pathlib import Path

source, release, fixture, records, snapshot = map(Path, sys.argv[1:])
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
prepare = load('fixture_prepare', source / 'deploy/model-control/prepare-secrets.py')
prepare.DIRECTORY = fixture / 'credentials'
prepare.main()
checker = release / 'verify-staged-secrets.py'
checker.write_text('import importlib.util\nfrom pathlib import Path\n'
    f's = importlib.util.spec_from_file_location("fixture_verifier", {str(release / "actual-verifier.py")!r})\n'
    'm = importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\n'
    f'm.DIRECTORY = Path({str(prepare.DIRECTORY)!r})\nm.main()\n')
subprocess.run(['/usr/sbin/restorecon', '-F', str(checker)], check=True)
digest = hashlib.sha256(checker.read_bytes()).hexdigest()
assemble = load('fixture_assemble', release / 'assemble-coordinator.py')
commit, artifact_hash = 'a' * 40, 'b' * 64
bad_record = records / 'rejected'
good_record = records / 'accepted'
bad_record.mkdir(mode=0o700)
good_record.mkdir(mode=0o700)
def arguments(directory, verification):
    return dict(source=release, snapshot=snapshot, journal_dir=directory, commit=commit,
        artifact_sha256=artifact_hash, checker_sha256=digest, expected_client_user='vmtest',
        verify_release=verification, preflight=lambda: True, check_local_idle=lambda: True, check_running=lambda: True, check_database_fence=lambda: True, studio_generation=SimpleNamespace(
            mark_stopped=lambda: True, bind_replacement=lambda: True, check=lambda: True),
        check_caddy_transition=lambda: True, check_restored=lambda: True, install=lambda _: True,
        verify_new=lambda: True, verify_restored=lambda: True)
missing_fence = arguments(bad_record, lambda *_: True)
missing_fence['check_database_fence'] = None
try:
    assemble.assemble(**missing_fence)
except ValueError:
    pass
else:
    raise SystemExit('DB 쓰기 차단 검사기 없이 시험 조립이 허용됐습니다.')
if (bad_record / 'migration-events.jsonl').exists():
    raise SystemExit('DB 쓰기 차단 검사기 거절 전에 기록이 생성됐습니다.')
print('DB 쓰기 차단 검사기 누락 시 배포 기록 생성 전 거절 확인', flush=True)
try:
    assemble.assemble(**arguments(bad_record, lambda *_: False))
except ValueError:
    pass
else:
    raise SystemExit('검증되지 않은 시험 릴리스를 허용했습니다.')
if (bad_record / 'migration-events.jsonl').exists():
    raise SystemExit('릴리스 거절 전에 기록이 생성됐습니다.')
print('시험 릴리스 출처 거절 시 배포 기록 생성 전 중단 확인', flush=True)
valid_args = arguments(good_record, lambda c, h: c == commit and h == artifact_hash)
runner, journal = assemble.assemble(**valid_args)
try:
    if runner.backup.check_database_fence is not valid_args['check_database_fence']:
        raise SystemExit('시험 DB 쓰기 차단 검사기가 백업 어댑터에 전달되지 않았습니다.')
    print('모의 DB 쓰기 차단 검사기를 실제 백업 어댑터에 전달 확인', flush=True)
    if runner.preflight() is not True:
        raise SystemExit('시험 설정 사전 검증에 실패했습니다.')
    rows = [json.loads(line) for line in (good_record / 'migration-events.jsonl').read_text().splitlines()]
    if len(rows) != 1 or rows[0].get('event') != 'release' or rows[0].get('commit') != commit or rows[0].get('sha256') != artifact_hash:
        raise SystemExit('시험 릴리스 식별 기록이 다릅니다.')
    print('고정 해시 설정·실제 어댑터 조립 및 시험 릴리스 기록 확인', flush=True)
    (prepare.DIRECTORY / 'worker.env').write_text('MODEL_CONTROL_SWITCH_ENABLED=true\n')
    try:
        runner.preflight()
    except ValueError:
        pass
    else:
        raise SystemExit('전환 활성 시험 설정이 허용됐습니다.')
    if runner.phase != 'new':
        raise SystemExit('사전 검사만으로 배포 단계가 변경됐습니다.')
    print('시험 설정 불일치 시 배포 진입 전 거절 확인', flush=True)
finally:
    journal.close()
PY
echo "시험 기록 보관: $release $fixture $records"
