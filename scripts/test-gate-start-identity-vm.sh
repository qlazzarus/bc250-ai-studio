#!/usr/bin/env bash
# Test real fixture process credentials with a simulated startup hold.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 \
  && -f $1/backend/app/services/gate_process_identity.py ]] || exit 1
records=$(mktemp -d /var/backups/bc250-gate-start-identity.XXXXXXXX)
candidate=$(mktemp -d /opt/bc250-gate-start-identity.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
good="bc250-start-id-good-$suffix.service"
bad="bc250-start-id-bad-$suffix.service"
studio="bc250-start-id-studio-$suffix.service"
client="bc250-start-id-client-$suffix.service"
for unit in "$good" "$bad" "$studio" "$client"; do
  [[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
done
trap 'echo "시험 중단. 시험 unit과 기록 보존: $good $bad $studio $client $records $candidate" >&2' ERR
[[ -z $(find "$1/backend" -type l -print -quit) ]] || exit 1
cp -R --no-preserve=ownership "$1/backend" "$candidate/backend"
chmod -R go-w "$candidate/backend"
restorecon -RF "$candidate"
systemd-run --quiet --unit="$good" --property=Type=exec --property=User=ai-gate \
  --property=Group=ai-gate --property=KillMode=control-group --property=NoNewPrivileges=yes /usr/bin/sleep infinity
systemd-run --quiet --unit="$bad" --property=Type=exec --property=User=ai-gate \
  --property=Group=ai-gate --property=KillMode=control-group --property=NoNewPrivileges=no /usr/bin/sleep infinity
systemd-run --quiet --unit="$studio" --property=Type=exec --property=User=ai-studio \
  --property=Group=ai-studio --property=KillMode=control-group /usr/bin/sleep infinity
systemd-run --quiet --unit="$client" --property=Type=exec --property=User=vmtest \
  --property=Group=vmtest --property=KillMode=control-group \
  --property=Environment=LLM_GATE_API_KEY=vm-fixture-admin-key-0123456789abcdef /usr/bin/sleep infinity
/opt/bc250-model-control/.venv/bin/python -I - "$candidate/backend" "$good" "$bad" "$studio" "$client" <<'PY'
import asyncio
import sys
import time

sys.path.insert(0, sys.argv[1])
from app.services import client_gate_check, gate_admin, gate_process_identity

good, bad, studio, client = sys.argv[2:]
mapping = {'bc250-llm-gate.service': bad, 'bc250-ai-studio.service': studio,
           'bc250-llm-client.service': client}
real_service_ready = gate_admin.service_ready
real_identity = gate_process_identity.unit_identity
gate_admin.service_ready = lambda unit, account: real_service_ready(mapping[unit], account)
client_gate_check.service_ready = gate_admin.service_ready
gate_process_identity.unit_identity = lambda unit, user, group: real_identity(mapping[unit], user, group)
gate_admin.read_key = lambda _: 'vm-fixture-admin-key-0123456789abcdef'
client_gate_check.read_key = gate_admin.read_key
gate_admin.check_gate_identity = lambda *_: None
client_gate_check.check_gate_identity = lambda *_: None
gate_admin.check_studio_protocol = lambda *_: None

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

class LLM:
    def __init__(self): self.holds = ['legacy', 'startup']
    async def gate(self, method):
        assert method == 'GET'
        return {'protocol': 2, 'durable': True, 'holds': list(self.holds)}
    async def drain(self): pass
    async def update_administrator_hold(self, hold, *, acquire):
        assert hold == 'startup' and not acquire
        self.holds.remove(hold)

class Service:
    async def ensure_settled(self): pass
    async def healthy(self, model): assert model == 'fake'

class Registry:
    def current_model(self): return 'fake'

async def confirm(llm):
    lock = Lock()
    try:
        await gate_admin.confirm_startup(lock, Journal(), Client(), llm, Service(), Registry(),
            lambda: gate_admin.coordinated_participants_are_ready('vmtest'))
    finally:
        assert not lock.held

for _ in range(60):
    try:
        gate_process_identity.unit_identity('bc250-llm-gate.service', 'ai-gate', 'ai-gate')
        break
    except (OSError, ValueError):
        time.sleep(.5)
else:
    raise SystemExit('시험 gate 준비 시간 초과')
llm = LLM()
try:
    asyncio.run(confirm(llm))
except ValueError as error:
    if 'NoNewPrivileges' not in str(error):
        raise
    assert llm.holds == ['legacy', 'startup']
    print('시험 gate 권한이 부적절하면 시작 보류 유지 확인', flush=True)
else:
    raise SystemExit('부적절한 시험 gate 권한을 잘못 허용했습니다.')
mapping['bc250-llm-gate.service'] = good
for _ in range(60):
    try:
        asyncio.run(confirm(llm))
        break
    except (OSError, RuntimeError, ValueError):
        time.sleep(.5)
else:
    raise SystemExit('정상 시험 프로세스의 시작 확인 시간 초과')
assert llm.holds == ['legacy']
print('정상 시험 프로세스·Client 검증 후 startup만 해제 확인', flush=True)
PY
systemctl stop "$good" "$bad" "$studio" "$client"
trap - ERR
echo "시험 서비스 정리 완료; 기록 보관: $records $candidate"
echo '시험 gate HTTP 인증·Studio 조율·모델 health·보류는 모의입니다. UID별 프로세스와 systemd 권한은 실제 시험 서비스입니다.'
