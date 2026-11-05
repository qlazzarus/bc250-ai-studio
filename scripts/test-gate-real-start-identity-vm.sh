#!/usr/bin/env bash
# Disposable owned gate with real authentication and durable test holds.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 \
  && -f $1/backend/app/services/gate_process_identity.py ]] || exit 1
python=/opt/bc250-model-control/.venv/bin/python
[[ -x $python && -z $(ss -H -ltn 'sport = :18888') ]] || exit 1
records=$(mktemp -d /var/backups/bc250-real-start-identity.XXXXXXXX)
candidate=$(mktemp -d /opt/bc250-real-start-identity.XXXXXXXX)
state=$(mktemp -d /var/lib/bc250-real-start-identity.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
good="bc250-real-id-good-$suffix.service"
bad="bc250-real-id-bad-$suffix.service"
studio="bc250-real-id-studio-$suffix.service"
client="bc250-real-id-client-$suffix.service"
for unit in "$good" "$bad" "$studio" "$client"; do
  [[ $(systemctl show "$unit" -p LoadState --value) == not-found \
    && ! -e /etc/systemd/system/$unit ]] || exit 1
done
trap 'echo "시험 중단. 시험 unit과 기록 보존: $good $bad $studio $client $records $candidate $state" >&2' ERR
[[ -z $(find "$1/backend" -type l -print -quit) ]] || exit 1
chmod 0755 "$candidate"
cp -R --no-preserve=ownership "$1/backend" "$candidate/backend"
chmod -R go-w "$candidate/backend"
chown ai-gate:ai-gate "$state"
chmod 0700 "$state"
printf '%s\n' '{"holds":["legacy"]}' > "$state/holds.json"
chown ai-gate:ai-gate "$state/holds.json"
chmod 0600 "$state/holds.json"
cat > "$candidate/gate.env" <<EOF
GATE_API_KEY=vm-fixture-admin-key-0123456789abcdef
GATE_STUDIO_KEY=vm-fixture-studio-key-0123456789abcde
GATE_SWITCH_KEY=vm-fixture-switch-key-0123456789abcde
GATE_OWNED_CONTROL=true
GATE_STATE_PATH=$state/holds.json
EOF
chmod 0600 "$candidate/gate.env"
for unit in "$good" "$bad"; do
  no_new=yes
  [[ $unit == "$bad" ]] && no_new=no
  cat > "/etc/systemd/system/$unit" <<EOF
[Service]
User=ai-gate
Group=ai-gate
EnvironmentFile=$candidate/gate.env
ExecStart=$python -I -m uvicorn app.gate:create_gate_app --factory --app-dir $candidate/backend --host 127.0.0.1 --port 18888 --workers 1 --no-access-log
KillMode=control-group
NoNewPrivileges=$no_new
EOF
done
restorecon -RF "$candidate" "$state" "$records"
restorecon -F "/etc/systemd/system/$good" "/etc/systemd/system/$bad"
systemctl daemon-reload
systemctl start "$bad"
systemd-run --quiet --unit="$studio" --property=Type=exec --property=User=ai-studio \
  --property=Group=ai-studio --property=KillMode=control-group /usr/bin/sleep infinity
systemd-run --quiet --unit="$client" --property=Type=exec --property=User=vmtest \
  --property=Group=vmtest --property=KillMode=control-group \
  --property=Environment=LLM_GATE_API_KEY=vm-fixture-admin-key-0123456789abcdef /usr/bin/sleep infinity
"$python" -I - "$candidate/backend" "$good" "$bad" "$studio" "$client" <<'PY'
import asyncio
import subprocess
import sys
import time
from types import SimpleNamespace

sys.path.insert(0, sys.argv[1])
import httpx
from app.services import client_gate_check, gate_admin, gate_process_identity

good, bad, studio, client = sys.argv[2:]
mapping = {'bc250-llm-gate.service': bad, 'bc250-ai-studio.service': studio,
           'bc250-llm-client.service': client}
admin = 'vm-fixture-admin-key-0123456789abcdef'
switch = 'vm-fixture-switch-key-0123456789abcde'
base = 'http://127.0.0.1:18888/control'
real_service_ready = gate_admin.service_ready
real_identity = gate_process_identity.unit_identity
gate_admin.service_ready = lambda unit, account: real_service_ready(mapping[unit], account)
client_gate_check.service_ready = gate_admin.service_ready
gate_process_identity.unit_identity = lambda unit, user, group: real_identity(mapping[unit], user, group)
gate_admin.read_key = lambda name: switch if name == 'switch-gate-key' else admin
client_gate_check.read_key = gate_admin.read_key
def identity(token, role):
    response = httpx.get(base + '/identity', headers={'Authorization': 'Bearer ' + token},
                         timeout=5, trust_env=False)
    response.raise_for_status()
    if response.json() != {'role': role, 'protocol': 2}:
        raise RuntimeError('시험 gate 인증 역할 오류')
gate_admin.check_gate_identity = identity
client_gate_check.check_gate_identity = identity
gate_admin.check_studio_protocol = lambda *_: None
settings = SimpleNamespace(admission_url=base, admission_key=admin,
                           llm_service='llama-server.service', allowed_services=['llama-server.service'])
class Gate(gate_admin.GateAdministrator):
    async def drain(self): pass
gate = Gate(settings)
class Lock:
    held = False
    def acquire(self): self.held = True
    def release(self): self.held = False
class Journal:
    def read(self): return {}
class Client:
    async def request(self, operation):
        assert operation == 'pending'
        return {'operation': None}
class Service:
    async def ensure_settled(self): pass
    async def healthy(self, model): assert model == 'fake'
class Registry:
    def current_model(self): return 'fake'
async def ready():
    for _ in range(90):
        try:
            return await gate.gate('GET')
        except httpx.ConnectError:
            await asyncio.sleep(.5)
    raise RuntimeError('시험 gate 응답 시간 초과')
async def confirm():
    lock = Lock()
    try:
        await gate_admin.confirm_startup(lock, Journal(), Client(), gate, Service(), Registry(),
            lambda: gate_admin.coordinated_participants_are_ready('vmtest'))
    finally:
        assert not lock.held
async def main():
    state = await ready()
    assert state['paused'] and set(state['holds']) == {'legacy', 'startup'}
    try:
        await confirm()
    except ValueError as error:
        if 'NoNewPrivileges' not in str(error): raise
    else:
        raise RuntimeError('부적절한 시험 gate가 허용됐습니다.')
    state = await gate.gate('GET')
    assert state['paused'] and set(state['holds']) == {'legacy', 'startup'}
    print('실제 시험 gate의 권한 불일치 시 두 보류 유지 확인', flush=True)
    subprocess.run(['/usr/bin/systemctl', 'stop', bad], check=True, timeout=60)
    mapping['bc250-llm-gate.service'] = good
    subprocess.run(['/usr/bin/systemctl', 'start', good], check=True, timeout=60)
    state = await ready()
    assert state['paused'] and set(state['holds']) == {'legacy', 'startup'}
    for attempt in range(60):
        try:
            await confirm()
            break
        except (OSError, RuntimeError, ValueError):
            if attempt == 59: raise
            await asyncio.sleep(.5)
    state = await gate.gate('GET')
    assert state['paused'] and state['holds'] == ['legacy']
    print('실제 시험 gate 인증과 Client 키 검증 후 startup만 해제 확인', flush=True)
asyncio.run(main())
PY
systemctl stop "$good" "$studio" "$client"
rm -- "/etc/systemd/system/$good" "/etc/systemd/system/$bad"
systemctl daemon-reload
trap - ERR
echo "시험 서비스 정리 완료; 기록 보관: $records $candidate $state"
echo 'gate 인증·보류와 프로세스 계정은 실제 시험 구성입니다. Studio 응답·모델 health·잠금·작업 상태는 모의이며 운영 서비스는 변경하지 않았습니다.'
