#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && ( $# == 1 || $# == 5 ) ]] || exit 1
source_dir=$1
python=/opt/bc250-model-control/.venv/bin/python
unit=bc250-deployment-hold-fixture.service
unit_file=/etc/systemd/system/$unit
[[ -x $python && -f $source_dir/backend/app/services/gate_admin.py ]] || exit 1
[[ ! -e $unit_file && ! -L $unit_file && $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
[[ -z $(ss -H -ltn 'sport = :18888') ]] || exit 1
fixture=$(mktemp -d /opt/bc250-deployment-hold.XXXXXXXX)
state=$(mktemp -d /var/lib/bc250-deployment-hold.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-deployment-hold.XXXXXXXX)
trap 'echo "시험 중단. 시험 unit과 기록 보존: $fixture $state $records $unit_file" >&2' ERR
chmod 0755 "$fixture"
mkdir -m 0755 "$fixture/backend"
cp -R --no-preserve=ownership "$source_dir/backend/app" "$fixture/backend/app"
printf '%s\n' '{"holds":[]}' > "$state/holds.json"
chmod 0600 "$state/holds.json"
cat > "$fixture/gate.env" <<EOF
GATE_API_KEY=fixture-admin-key-0123456789abcdef
GATE_STUDIO_KEY=fixture-studio-key-0123456789abcdef
GATE_SWITCH_KEY=fixture-switch-key-0123456789abcdef
GATE_OWNED_CONTROL=true
GATE_STATE_PATH=$state/holds.json
EOF
chmod 0600 "$fixture/gate.env"
cat > "$unit_file" <<EOF
[Service]
EnvironmentFile=$fixture/gate.env
ExecStart=$python -I -m uvicorn app.gate:create_gate_app --factory --app-dir $fixture/backend --host 127.0.0.1 --port 18888 --workers 1 --no-access-log
KillMode=control-group
EOF
restorecon -RF "$fixture" "$state" "$records"
restorecon -F "$unit_file"
systemctl daemon-reload
systemctl start "$unit"
"$python" -I - "$fixture/backend" "$state" "$records" "$source_dir" "${2:-}" "${3:-}" "${4:-}" "${5:-}" <<'PY'
import asyncio
import importlib.util
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, sys.argv[1])
import httpx
from app.services.gate_admin import GateAdministrator, confirm_startup, confirm_startup_with_deployment_hold

settings = SimpleNamespace(admission_url='http://127.0.0.1:18888/control',
                           admission_key='fixture-admin-key-0123456789abcdef',
                           llm_service='llama-server.service',
                           allowed_services=['llama-server.service'])
class FixtureGate(GateAdministrator):
    async def drain(self):
        pass  # llama는 이 시험의 범위 밖이다.

gate = FixtureGate(settings)
archive, staged, release_commit, release_digest = sys.argv[5:9]
if archive:
    verifier_spec = importlib.util.spec_from_file_location('staged_release_check',
        Path(sys.argv[4]) / 'deploy/model-control/verify-staged-release.py')
    verifier_module = importlib.util.module_from_spec(verifier_spec)
    verifier_spec.loader.exec_module(verifier_module)
    release_checker = verifier_module.StagedReleaseCheck(archive, staged, release_commit, release_digest)
else:
    release_commit, release_digest = 'a' * 40, 'b' * 64
    release_checker = lambda *_: True
spec = importlib.util.spec_from_file_location('migration_journal',
    Path(sys.argv[4]) / 'deploy/model-control/migration-journal.py')
journal_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journal_module)
journal = journal_module.MigrationJournal(Path(sys.argv[3]))
journal.release(release_commit, release_digest)  # 시험 전용이며 실제 Actions 출처가 아니다.
spec = importlib.util.spec_from_file_location('record_inspector',
    Path(sys.argv[4]) / 'deploy/model-control/inspect-deployment-record.py')
record_inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(record_inspector)

class Lock:
    held = False
    def acquire(self):
        if self.held:
            raise RuntimeError('시험 잠금 중복')
        self.held = True
    def release(self):
        self.held = False

class Journal:
    def read(self):
        return {}

class Client:
    async def request(self, operation):
        return {'operation': None}

class Service:
    async def ensure_settled(self):
        pass
    async def healthy(self, model):
        if model != 'fixture':
            raise RuntimeError('시험 모델 오류')

class Registry:
    def current_model(self):
        return 'fixture'

async def mutate_fixture_hold(method, hold, generation=None):
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        headers = {'Authorization': 'Bearer ' + settings.admission_key}
        if generation is not None:
            headers['If-Match'] = generation
        response = await client.request(method, settings.admission_url + '/holds/' + hold,
            headers=headers)
        response.raise_for_status()

async def main():
    for attempt in range(120):
        try:
            initial = await gate.gate('GET')
            break
        except httpx.ConnectError:
            if attempt == 119:
                raise
            await asyncio.sleep(.5)
    if set(initial['holds']) != {'startup'}:
        raise RuntimeError('시험 gate 초기 보류가 다릅니다.')
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        url = settings.admission_url + '/holds/admin-deployment'
        headers = {'Authorization': 'Bearer ' + settings.admission_key, 'If-None-Match': '*'}
        first, second = await asyncio.gather(client.put(url, headers=headers),
                                             client.put(url, headers=headers))
        if sorted((first.status_code, second.status_code)) != [200, 409]:
            raise RuntimeError('시험 동시 보류 요청 결과가 다릅니다.')
        winner = first if first.status_code == 200 else second
        created = winner.json()
        race_generation = created.pop('generation', None)
        if created != {'paused': True, 'held': True, 'created': True} or not race_generation:
            raise RuntimeError('시험 보류 생성 응답이 다릅니다.')
    status = await gate.gate('GET')
    if status['paused'] is not True or set(status['holds']) != {'startup', 'admin-deployment'}:
        raise RuntimeError('시험 동시 보류 결과가 유지되지 않았습니다.')
    await mutate_fixture_hold('DELETE', 'admin-deployment', race_generation)
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        created = await client.put(url, headers=headers)
        created.raise_for_status()
        replacement_generation = created.json().get('generation')
        if not replacement_generation or replacement_generation == race_generation:
            raise RuntimeError('시험 보류 재생성 세대가 다르지 않습니다.')
        stale_headers = {'Authorization': 'Bearer ' + settings.admission_key,
                         'If-Match': race_generation}
        stale = await client.delete(url, headers=stale_headers)
        if stale.status_code != 412:
            raise RuntimeError('시험 이전 세대 해제가 거절되지 않았습니다.')
    status = await gate.gate('GET')
    if (status['paused'] is not True or set(status['holds']) != {'startup', 'admin-deployment'}
            or status.get('deployment_generation') != replacement_generation):
        raise RuntimeError('시험 재생성 보류가 보존되지 않았습니다.')
    await mutate_fixture_hold('DELETE', 'admin-deployment', replacement_generation)
    status = await gate.gate('GET')
    if status['paused'] is not True or set(status['holds']) != {'startup'}:
        raise RuntimeError('시험 경합 보류 정리 후 startup 상태가 다릅니다.')
    print('시험 gate 동시 보류 생성 한 건 성공·한 건 충돌 및 startup 유지 확인', flush=True)
    print('시험 보류 재생성 후 이전 세대 해제 거절과 새 보류 유지 확인', flush=True)
    attempts = 0

    async def confirm_lost():
        nonlocal attempts
        attempts += 1
        await gate.update_administrator_hold('startup', acquire=False)
        raise TimeoutError('simulated response loss')

    try:
        await confirm_startup_with_deployment_hold(gate, confirm_lost, record=journal)
    except TimeoutError:
        pass
    else:
        raise RuntimeError('시험 응답 유실이 감지되지 않았습니다.')
    status = await gate.gate('GET')
    if status['paused'] is not True or set(status['holds']) != {'admin-deployment'} or attempts != 1:
        raise RuntimeError('시험 배포 보류 또는 요청 횟수가 다릅니다.')
    print('기존 관리자 보류 없이 시험 gate의 독립 배포 보류 유지와 응답 유실 확인', flush=True)
    try:
        await confirm_startup_with_deployment_hold(gate, confirm_lost, record=journal)
    except RuntimeError:
        pass
    else:
        raise RuntimeError('불확실한 시험 확인의 재시도가 허용됐습니다.')
    if attempts != 1:
        raise RuntimeError('시험 확인이 재시도됐습니다.')
    print('시험 보류 상태의 자동 재시도 거절 확인', flush=True)
    rows = [json.loads(line) for line in (Path(sys.argv[3]) / 'migration-events.jsonl').read_text().splitlines()]
    events = [row['event'] for row in rows]
    if events != ['release', 'deployment_hold:begin', 'deployment_hold:generation',
                  'deployment_hold:confirmed', 'deployment_confirmation:begin']:
        raise RuntimeError('시험 배포 보류 또는 미완료 기록이 다릅니다.')
    generation = rows[2]['generation']
    if not record_inspector.matches_release_record(Path(sys.argv[3]), release_commit, release_digest, release_checker):
        raise RuntimeError('시험 릴리스 기록 비교에 실패했습니다.')
    wrong_commit = ('0' if release_commit[0] != '0' else '1') + release_commit[1:]
    if record_inspector.matches_release_record(Path(sys.argv[3]), wrong_commit, release_digest, release_checker):
        raise RuntimeError('다른 시험 릴리스 기록이 허용됐습니다.')
    if record_inspector.matches_release_record(Path(sys.argv[3]), release_commit, release_digest, lambda *_: False):
        raise RuntimeError('시험 릴리스 인증 실패가 허용됐습니다.')
    print('시험 릴리스 기록 일치 및 불일치·모의 인증 실패 거절 확인', flush=True)
    if not record_inspector.matches_recorded_generation(Path(sys.argv[3]), await gate.gate('GET')):
        raise RuntimeError('시험 기록과 gate 세대가 일치하지 않습니다.')
    print('인증된 시험 gate 상태와 보존 기록의 보류 세대 일치 확인', flush=True)
    if not record_inspector.matches_release_and_generation(
            Path(sys.argv[3]), release_commit, release_digest, release_checker, await gate.gate('GET')):
        raise RuntimeError('시험 릴리스와 gate 세대 결합 검사에 실패했습니다.')
    if archive:
        print('시험 아티팩트·스테이징과 실제 시험 gate 세대의 동일 기록 연결 확인', flush=True)
    else:
        print('단일 시험 기록의 릴리스·gate 세대 결합 확인 (릴리스 출처는 모의)', flush=True)
    bad_dir = Path(sys.argv[3]) / 'duplicate-key-test'
    bad_dir.mkdir(mode=0o700)
    bad_file = bad_dir / 'migration-events.jsonl'
    bad_file.write_bytes((Path(sys.argv[3]) / 'migration-events.jsonl').read_bytes()
                         + b'{"event":"other","event":"complete"}\n')
    bad_file.chmod(0o600)
    try:
        record_inspector.matches_recorded_generation(bad_dir, await gate.gate('GET'))
    except ValueError:
        pass
    else:
        raise RuntimeError('중복 키가 있는 시험 기록이 허용됐습니다.')
    print('중복 키가 있는 시험 기록을 세대 비교 전 거절 확인', flush=True)
    print('시험 배포 보류 완료와 확인 미완료 기록 확인', flush=True)
    shutil.copy2(Path(sys.argv[2]) / 'holds.json', Path(sys.argv[3]) / 'before-release-holds.json')
    subprocess.run(['/usr/bin/systemctl', 'restart', 'bc250-deployment-hold-fixture.service'],
                   check=True, timeout=90)
    for attempt in range(120):
        try:
            status = await gate.gate('GET')
            break
        except httpx.ConnectError:
            if attempt == 119:
                raise
            await asyncio.sleep(.5)
    if (status['paused'] is not True or set(status['holds']) != {'startup', 'admin-deployment'}
            or status.get('deployment_generation') != generation):
        raise RuntimeError('시험 gate 재시작 후 보류가 보존되지 않았습니다.')
    print('시험 gate 재시작 후 배포 보류 보존과 startup 보류 재생성 확인', flush=True)
    def load_fixture(name, filename):
        fixture_spec = importlib.util.spec_from_file_location(name, Path(sys.argv[4]) / 'deploy/model-control' / filename)
        fixture_module = importlib.util.module_from_spec(fixture_spec)
        fixture_spec.loader.exec_module(fixture_module)
        return fixture_module
    lock_module = load_fixture('fixture_gpu_fence', 'advisory-gpu-fence.py')
    handoff_module = load_fixture('fixture_gpu_handoff', 'gpu-lock-handoff.py')
    sequence_module = load_fixture('fixture_start_sequence', 'startup-lock-sequence.py')
    hold_module = load_fixture('fixture_deployment_check', 'deployment-hold-check.py')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def authenticated_status():
        req = urllib.request.Request(settings.admission_url,
            headers={'Authorization': 'Bearer ' + settings.admission_key})
        with opener.open(req, timeout=10) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            raise RuntimeError('시험 gate 응답 크기 오류')
        return json.loads(raw)
    # Ownership and other safety barriers remain simulated, not proven by generation.
    hold_check = hold_module.DeploymentHoldCheck(generation=generation, fetch_status=authenticated_status,
        matches_record=lambda state: record_inspector.matches_recorded_generation(Path(sys.argv[3]), state),
        check_ownership=lambda _: True)
    lock_path = Path(sys.argv[2]) / 'startup-sequence.lock'
    lock_path.touch(mode=0o600, exist_ok=False)
    real_lock = lock_module.AdvisoryGPUFence(lock_path, group_id=0)
    handoff = handoff_module.GPULockHandoff(fence=real_lock, old_generation_gone=lambda: True,
        other_callers_blocked=lambda: True, gpu_safe=lambda: True, prepare_new_lock=lambda: lock_path.is_file())
    lock_records = Path(sys.argv[3]) / 'startup-lock'
    lock_records.mkdir(mode=0o700)
    lock_journal = journal_module.MigrationJournal(lock_records)
    lock_confirm = []
    sequence = sequence_module.StartupLockSequence(record=lock_journal, check_pre_handoff=lambda: True,
        prepare_tmpfiles=lambda: True, handoff=handoff, check_before_confirm=lambda: True,
        check_deployment_hold=hold_check, confirm_startup=lambda: lock_confirm.append(True) or True)
    if not sequence.begin() or not real_lock.check():
        raise RuntimeError('시험 gate 보류와 잠금 연결 실패')
    print('인증된 시험 gate·기록의 배포 보류 세대로 시험 잠금 획득 확인', flush=True)
    await mutate_fixture_hold('PUT', 'admin-fixture')
    await mutate_fixture_hold('PUT', 'startup')
    lock = Lock()
    try:
        await confirm_startup(lock, Journal(), Client(), gate, Service(), Registry(),
                              lambda: None, release_id='admin-deployment',
                              check_deployment_ownership=lambda: True, deployment_generation=generation)
    except RuntimeError:
        pass
    else:
        raise RuntimeError('시험 startup 보류 잔존 시 해제가 허용됐습니다.')
    status = await gate.gate('GET')
    if set(status['holds']) != {'startup', 'admin-deployment', 'admin-fixture'} or lock.held:
        raise RuntimeError('시험 보류 거절 후 상태가 다릅니다.')
    await mutate_fixture_hold('DELETE', 'startup')
    await confirm_startup(lock, Journal(), Client(), gate, Service(), Registry(),
                          lambda: None, release_id='admin-deployment',
                          check_deployment_ownership=lambda: True, deployment_generation=generation)
    status = await gate.gate('GET')
    if status['paused'] is not True or set(status['holds']) != {'admin-fixture'} or lock.held:
        raise RuntimeError('시험 해제 후 기존 관리자 보류가 다릅니다.')
    print('시험 startup 보류 잔존 시 해제 거절 및 기존 관리자 보류 보존 확인', flush=True)
    replacement = await gate.acquire_deployment_hold()
    status = await gate.gate('GET')
    if record_inspector.matches_recorded_generation(Path(sys.argv[3]), status):
        raise RuntimeError('이전 시험 기록을 재생성 보류와 잘못 일치시켰습니다.')
    if record_inspector.matches_release_and_generation(
            Path(sys.argv[3]), release_commit, release_digest, release_checker, status):
        raise RuntimeError('이전 시험 기록을 재생성 gate 세대에 결합했습니다.')
    print('시험 보류 재생성 시 이전 기록의 세대 불일치 확인', flush=True)
    try:
        sequence.confirm_after_client_restart()
    except sequence_module.StartupLockError:
        pass
    else:
        raise RuntimeError('바뀐 시험 gate 보류의 잠금 인계가 허용됐습니다.')
    if lock_confirm or real_lock.fd is None or not real_lock.check():
        raise RuntimeError('세대 불일치 후 시험 잠금 또는 확인 상태 오류')
    real_lock.release()
    lock_journal.close()
    print('시험 gate 보류 세대 변경 시 확인 전 중단과 시험 잠금 유지 확인', flush=True)
    await gate.release_deployment_hold(replacement)

try:
    asyncio.run(main())
finally:
    journal.close()
PY
systemctl stop "$unit"
[[ $(systemctl show "$unit" -p ActiveState --value) == inactive && $(systemctl show "$unit" -p MainPID --value) == 0 ]] || exit 1
mv -- "$unit_file" "$records/$unit"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 gate 보류와 기록 보관: $fixture $state $records"
echo 'Client·Studio·GPU 잠금·모델 health·직접 호출 차단·보류 소유권 검사는 모의입니다.'
