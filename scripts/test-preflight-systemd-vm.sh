#!/usr/bin/env bash
# Verify the current candidate under systemd and SELinux, on disposable files only.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test ]] || {
  echo '시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $(systemd-detect-virt) == qemu ]] || { echo 'QEMU 시험 VM이 아닙니다.' >&2; exit 1; }
[[ $# == 1 && -f "$1/backend/app/services/model_switch.py" ]] || {
  echo '시험 소스 경로가 필요합니다.' >&2; exit 1;
}
source_dir=$1
candidate=/opt/bc250-preflight-candidate
fixture=/opt/bc250-preflight-test
state=/var/lib/bc250-preflight-test
for path in "$candidate" "$fixture" "$state"; do
  [[ ! -e "$path" && ! -L "$path" ]] || { echo "이미 존재합니다: $path" >&2; exit 1; }
done
[[ $(getenforce) == Enforcing ]] || { echo 'SELinux Enforcing이 아닙니다.' >&2; exit 1; }
[[ -z $(find "$source_dir/backend" -type l -print -quit) ]] || {
  echo '시험 소스에 심볼릭 링크가 있습니다.' >&2; exit 1;
}

install -d -o root -g root -m 0755 "$candidate" "$fixture/config/models" "$fixture/models"
cp -R --no-preserve=ownership "$source_dir/backend" "$candidate/backend"
chmod -R go-w "$candidate/backend"
install -d -o root -g ai-studio -m 0750 "$state"
printf 'ACTIVE_MODEL=old\n' > "$fixture/config/active-model.conf"
for name in old new; do
  printf 'MODEL_NAME=%s\nMODEL_PATH=%s/models/%s.gguf\n' "$name" "$fixture" "$name" \
    > "$fixture/config/models/$name.conf"
  printf 'fake model\n' > "$fixture/models/$name.gguf"
done
printf '{}\n' > "$state/switch.json"
chown root:ai-studio "$state/switch.json"
chmod 0640 "$state/switch.json"
chmod 0644 "$fixture/config/active-model.conf" "$fixture/config/models/"*.conf "$fixture/models/"*.gguf
restorecon -RF "$candidate" "$fixture" "$state"

if [[ ! -e /run/bc250-gpu ]]; then
  systemd-tmpfiles --create "$source_dir/systemd/bc250-gpu-lock.conf"
fi

cat > "$candidate/probe.py" <<'PY'
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, '/opt/bc250-preflight-candidate/backend')
from app.services.model_control import ActiveModelWriter, ModelRegistry
from app.services.model_switch import ModelSwitch, SwitchAdmissionBlocked, SwitchJournal
from app.services.switch_adapters import AsyncGPULock

registry = ModelRegistry(Path('/opt/bc250-preflight-test/config'))
writer = ActiveModelWriter(registry)
journal = SwitchJournal('/var/lib/bc250-preflight-test/switch.json', secure_precreated=True)

class Gate:
    def __init__(self):
        self.holds = {'legacy'}
        self.calls = []
    async def acquire(self, hold):
        self.calls.append('acquire')
        self.holds.add(hold)
    async def drain(self):
        self.calls.append('drain')
    async def release(self, hold):
        self.calls.append('release')
        self.holds.remove(hold)

class Service:
    async def installed(self):
        return registry.list_models()
    async def current(self):
        return registry.current_model()
    async def validate_switch_preconditions(self):
        writer.validate_replacement()
    async def apply(self, model):
        writer.set_active(model)
    async def healthy(self, model):
        assert registry.current_model() == model

async def main():
    mode = sys.argv[1]
    gate = Gate()
    coordinator = ModelSwitch(journal, AsyncGPULock('/run/bc250-gpu/gpu.lock'), gate, Service())
    if mode in {'journal', 'model'}:
        try:
            await coordinator.switch('new')
        except SwitchAdmissionBlocked:
            pass
        else:
            raise AssertionError('레이블 불일치 요청이 거절되지 않았습니다.')
        assert journal.read() == {} and registry.current_model() == 'old'
        assert gate.calls == [] and gate.holds == {'legacy'}
        print(f'{mode} 레이블 불일치: gate 보류 및 기록 변경 전 거절 확인')
    elif mode == 'success':
        assert await coordinator.switch('new') == 'succeeded'
        assert journal.read() == {} and registry.current_model() == 'new'
        assert gate.calls == ['acquire', 'drain', 'release'] and gate.holds == {'legacy'}
        print('일치하는 레이블: 가짜 모델 전환과 legacy 보류 유지 확인')
    else:
        raise ValueError('알 수 없는 시험 모드')

asyncio.run(main())
PY
chmod 0644 "$candidate/probe.py"
restorecon -F "$candidate/probe.py"

run_probe() {
  local mode=$1 result=0 unit="bc250-preflight-check-$1"
  systemd-run --wait --collect --unit="$unit" \
    -p User=root -p Group=root -p UMask=0077 \
    -p NoNewPrivileges=yes -p PrivateTmp=yes -p ProtectHome=yes \
    -p ProtectSystem=strict \
    -p "ReadWritePaths=$fixture/config $state /run/bc250-gpu" \
    -p "RestrictAddressFamilies=AF_UNIX AF_INET" -p CapabilityBoundingSet=CAP_CHOWN \
    /opt/bc250-model-control/.venv/bin/python -I "$candidate/probe.py" "$mode" || result=$?
  journalctl -b -u "$unit" -n 30 --no-pager -o cat
  (( result == 0 )) || return "$result"
}

chcon -u unconfined_u "$state/switch.json"
run_probe journal
restorecon -F "$state/switch.json"
chcon -u unconfined_u "$fixture/config/active-model.conf"
run_probe model
restorecon -F "$fixture/config/active-model.conf"
run_probe success
echo '시험 완료. 실제 전환 기록과 운영 설정은 변경하지 않았습니다.'
