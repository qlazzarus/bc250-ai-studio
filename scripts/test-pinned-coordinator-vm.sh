#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# -ge 1 && $# -le 2 ]] || exit 1
source_dir=$1
mode=${2:-original}
[[ $mode == original || $mode == initial-install || $mode == initial-preparation || $mode == preparation-chain || $mode == record-release || $mode == record-release-gate ]] || exit 1
if [[ $mode == initial-install ]]; then mode=preparation-chain; fi
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
python3 - "$source_dir" "$tools" "$fixture" "$records" "$snapshot" "$mode" <<'PY'
import hashlib
import importlib.util
import io
import json
import secrets
import string
import tarfile
import sys
from pathlib import Path

source, tools, fixture, records, snapshot = map(Path, sys.argv[1:6])
mode = sys.argv[6]
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
if mode not in ('initial-preparation', 'preparation-chain', 'record-release', 'record-release-gate'):
    prepare.main()
target = Path('/opt/bc250-release.' + ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(8)))
print('시험 릴리스 경로:', target, flush=True)
commit = 'a' * 40
archive_path = records / 'candidate.tar.gz'
wrapper = ('import importlib.util, sys\nfrom pathlib import Path\nsys.dont_write_bytecode = True\n'
    'def main():\n'
    f'    s = importlib.util.spec_from_file_location("fixture_verifier", {str(target / "deploy/model-control/fixture-verifier.py")!r})\n'
    '    m = importlib.util.module_from_spec(s)\n    s.loader.exec_module(m)\n'
    f'    m.DIRECTORY = Path({str(prepare.DIRECTORY)!r})\n    m.main()\n'
    'if __name__ == "__main__": main()\n').encode()
contents = {}
for name in verifier.REQUIRED:
    path = source / name
    if name == 'COMMIT':
        contents[name] = (commit + '\n').encode()
    elif name == 'deploy/model-control/verify-staged-secrets.py':
        contents[name] = path.read_bytes() if mode == 'initial-preparation' else wrapper
    elif name in ('deploy/model-control/prepare-initial-settings.py', 'deploy/model-control/verify-initial-preparation.py') and mode in ('initial-preparation', 'preparation-chain'):
        code = path.read_text()
        mappings = (
                ('STATE', '/var/lib/bc250-model-control', fixture / 'state'),
                ('GATE', '/var/lib/bc250-llm-gate', fixture / 'gate'),
                ('CODE', '/opt/bc250-model-control', fixture / 'code'))
        if name.endswith('prepare-initial-settings.py'):
            mappings += (('CONFIG', '/etc/bc250-model-control', prepare.DIRECTORY),)
        for constant, original, replacement in mappings:
            old = f"{constant} = Path('{original}')"
            if old not in code:
                raise SystemExit('시험 준비 경로를 지정할 수 없습니다.')
            code = code.replace(old, f'{constant} = Path({str(replacement)!r})')
        contents[name] = code.encode()
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
if mode in ('record-release', 'record-release-gate'):
    inspector = load('record_inspector', source / 'deploy/model-control/inspect-deployment-record.py')
    journal_module = load('record_journal', source / 'deploy/model-control/migration-journal.py')
    record = journal_module.MigrationJournal(good_record)
    generation = 'd' * 32
    try:
        record.release(commit, digest)
        record('deployment_hold:begin')
        record.deployment_generation(generation)
        record('deployment_hold:confirmed')
        record('deployment_confirmation:begin')
    finally:
        record.close()
    gate_state = {'protocol': 2, 'durable': True, 'paused': True,
                  'holds': ['admin-deployment'], 'deployment_generation': generation}
    checker = tree.StagedReleaseCheck(archive_path, target, commit, digest)
    if not inspector.matches_release_and_generation(good_record, commit, digest, checker, gate_state):
        raise SystemExit('시험 릴리스와 기록이 일치하지 않습니다.')
    if inspector.matches_release_and_generation(good_record, 'c' * 40, digest, checker, gate_state):
        raise SystemExit('다른 시험 릴리스가 허용됐습니다.')
    print('시험 아티팩트·스테이징 검증과 기록의 릴리스·모의 gate 세대 연결 확인', flush=True)
    if mode == 'record-release-gate':
        (records / 'gate-target').write_text(str(target) + '\n')
        raise SystemExit(0)
    path = target / 'backend/app/main.py'
    path.write_bytes(path.read_bytes() + b'\n# fixture tamper\n')
    try:
        inspector.matches_release_and_generation(good_record, commit, digest, checker, gate_state)
    except ValueError:
        pass
    else:
        raise SystemExit('변조된 시험 릴리스가 허용됐습니다.')
    print('시험 스테이징 변조 시 기록 결합 검사 거절 확인', flush=True)
    print('시험 출처 식별자와 gate 상태는 모의이며 운영 복구 승인이 아닙니다.', flush=True)
    raise SystemExit(0)
if mode in ('initial-preparation', 'preparation-chain'):
    def preparation_args(directory, bootstrap_digest):
        return dict(root=target, archive=archive_path, bootstrap_checker=bootstrap,
            bootstrap_sha256=bootstrap_digest, journal_dir=directory, commit=commit, artifact_sha256=digest)
    wrong = ('0' if bootstrap_hash[0] != '0' else '1') + bootstrap_hash[1:]
    try:
        pinned.prepare_initial(**preparation_args(bad_record, wrong))
    except ValueError:
        pass
    else:
        raise SystemExit('잘못된 시험 부트스트랩 해시가 허용됐습니다.')
    if (bad_record / 'migration-events.jsonl').exists() or (fixture / 'state').exists():
        raise SystemExit('릴리스 거절 전에 시험 기록 또는 상태가 생성됐습니다.')
    if pinned.prepare_initial(**preparation_args(good_record, bootstrap_hash)) is not True:
        raise SystemExit('시험 인증 준비가 완료되지 않았습니다.')
    rows = [json.loads(line) for line in (good_record / 'migration-events.jsonl').read_text().splitlines()]
    if [item['event'] for item in rows] != ['release', 'initial_preparation:begin', 'initial_preparation:confirmed']:
        raise SystemExit('시험 준비 기록 순서가 올바르지 않습니다.')
    if not (fixture / 'state/switch.json').is_file() or not prepare.DIRECTORY.is_dir():
        raise SystemExit('시험 초기 상태 또는 설정이 없습니다.')
    print('인증된 시험 릴리스·준비 시작 및 완료 기록·초기 설정 연결 확인', flush=True)
    print('부트스트랩 해시 오류는 시험 기록과 상태 생성 전에 거절 확인', flush=True)
    if mode == 'preparation-chain':
        paths = {}
        for key in ('displaced', 'cache', 'model_cache', 'manifest_dir'):
            paths[key] = records / key
            paths[key].mkdir(mode=0o700)
        deployment = records / 'deployment'
        deployment.mkdir(mode=0o700)
        wiki_record = records / 'wiki-record'
        wiki_record.mkdir(mode=0o700)
        wiki_blocked = [False]
        options = dict(root=target, archive=archive_path, bootstrap_checker=bootstrap,
            bootstrap_sha256=bootstrap_hash, snapshot=snapshot, journal_dir=deployment,
            commit=commit, artifact_sha256=digest, expected_client_user='vmtest',
            preflight=lambda: True, check_local_idle=lambda: wiki_blocked[0], check_caddy_transition=lambda: True, check_restored=lambda: True,
            install=None, initial_install_paths=paths, wiki_record_dir=wiki_record,
            verify_new=lambda: True, verify_restored=lambda: True)
        try:
            pinned.assemble(**options, preparation_record=bad_record)
        except (ValueError, FileNotFoundError):
            pass
        else:
            raise SystemExit('미완료 시험 준비 기록이 허용됐습니다.')
        if (deployment / 'migration-events.jsonl').exists():
            raise SystemExit('준비 기록 거절 전에 배포 기록이 생성됐습니다.')
        runner, journal = pinned.assemble(**options, preparation_record=good_record)
        try:
            if runner.phase != 'new' or runner.runner.preflight() is not True:
                raise SystemExit('Wiki 차단 전 시험 사전 검증에 실패했습니다.')
            runner.runner.wiki_fence.check = lambda: wiki_blocked[0]
            if runner.runner.backup.check_local_idle() is not False:
                raise SystemExit('Wiki 차단 전 시험 유휴 검사가 허용됐습니다.')
            wiki_blocked[0] = True
            if runner.runner.backup.check_local_idle() is not True:
                raise SystemExit('Wiki 차단 후 시험 유휴 검사를 연결하지 못했습니다.')
            print('시험 동일 Wiki 차단 검사와 백업 유휴 검사 결합 확인 (차단·유휴 상태는 모의)', flush=True)
        finally:
            journal.close()
        factory_deployment = records / 'factory-deployment'
        factory_deployment.mkdir(mode=0o700)
        factory_wiki_record = records / 'factory-wiki'
        factory_wiki_record.mkdir(mode=0o700)
        factory_blocked = [False]
        created = []
        def make_idle(wiki):
            wiki.check = lambda: factory_blocked[0]
            idle_module = load('fixture_initial_idle', target / 'deploy/model-control/initial-local-idle.py')
            idle = idle_module.InitialLocalIdle(target / 'deploy/model-control', check_wiki=wiki.check,
                check_other_callers=lambda: True, check_gpu=lambda: True, llama_key=lambda: '')
            idle.observer.observe = lambda _guard, *, llama_key: llama_key == ''
            idle.listener.listener_identity = lambda: ('fixture',)
            created.append((wiki, idle))
            return idle
        factory_options = dict(options, journal_dir=factory_deployment, wiki_record_dir=factory_wiki_record,
                               check_local_idle=None, initial_idle_factory=make_idle)
        factory_runner, factory_journal = pinned.assemble(**factory_options, preparation_record=good_record)
        try:
            if len(created) != 1 or created[0][0] is not factory_runner.runner.wiki_fence:
                raise SystemExit('시험 조율기와 검사기의 Wiki 객체가 다릅니다.')
            if factory_runner.runner.backup.check_local_idle() is not False:
                raise SystemExit('시험 Wiki 차단 전 유휴 검사가 허용됐습니다.')
            factory_blocked[0] = True
            if factory_runner.runner.backup.check_local_idle() is not True:
                raise SystemExit('시험 유휴 검사 후보 연결에 실패했습니다.')
        finally:
            factory_journal.close()
        print('시험 최초 유휴 검사 후보를 동일 Wiki 객체와 백업 어댑터에 연결 확인 (관찰·차단은 모의)', flush=True)
        print('완료된 준비 기록과 빈 journal을 확인한 뒤 시험 배포 조율기 조립 확인', flush=True)
        print('미완료 준비 기록은 배포 기록 생성 전에 거절 확인', flush=True)
    print('시험 경로만 사용했으며 서비스나 모델을 변경하지 않았습니다.', flush=True)
    raise SystemExit(0)
def args(directory, bootstrap_digest):
    return dict(root=target, archive=archive_path, bootstrap_checker=bootstrap,
        bootstrap_sha256=bootstrap_digest, snapshot=snapshot, journal_dir=directory,
        commit=commit, artifact_sha256=digest, expected_client_user='vmtest',
        preflight=lambda: True, check_local_idle=lambda: True, check_caddy_transition=lambda: True, check_restored=lambda: True,
        install=lambda _: True, verify_new=lambda: True, verify_restored=lambda: True)
if mode == 'initial-install':
    paths = {}
    for key in ('displaced', 'cache', 'model_cache', 'manifest_dir'):
        paths[key] = records / key
        paths[key].mkdir(mode=0o700)
    options = args(good_record, bootstrap_hash)
    options.update(install=None, initial_install_paths=paths)
    runner, journal = pinned.assemble(**options)
    try:
        adapter = runner.runner.install
        if (type(adapter).__name__ != 'InitialInstallAdapter' or adapter.release != target
                or adapter.check_release() is not True or adapter.check_configuration() is not True
                or runner.phase != 'new'):
            raise SystemExit('시험 최초 설치 어댑터 연결이 올바르지 않습니다.')
        if any(paths['displaced'].iterdir()) or any(paths['manifest_dir'].iterdir()):
            raise SystemExit('조립 단계에서 시험 설치 파일이 생성됐습니다.')
        print('검증된 시험 릴리스·설정·유지보수 검사와 최초 설치 어댑터 조립 확인', flush=True)
        print('설치·서비스 변경은 수행하지 않았으며 운영 상태 검사는 모의입니다.', flush=True)
    finally:
        journal.close()
    print(f'시험 도구와 기록 보관: {tools} {fixture} {records}', flush=True)
    raise SystemExit(0)
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
if [[ $mode == record-release-gate ]]; then
  target_path=$(cat "$records/gate-target")
  [[ $target_path =~ ^/opt/bc250-release\.[[:alnum:]]{8}$ ]] || exit 1
  archive_digest=$(sha256sum "$records/candidate.tar.gz" | cut -d ' ' -f 1)
  [[ $archive_digest =~ ^[0-9a-f]{64}$ ]] || exit 1
  bash "$source_dir/scripts/test-deployment-hold-vm.sh" "$source_dir" \
    "$records/candidate.tar.gz" "$target_path" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$archive_digest"
fi
echo "시험 도구와 기록 보관: $tools $fixture $records"
