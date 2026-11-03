#!/usr/bin/env bash
# Clean up only the identified disposable VM fixture, retaining all evidence.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 0 ]] || exit 1
fixture=/var/backups/bc250-linked-migration.DX18Rx09
envdir=/etc/bc250-linked-fixture.vb7ubd8t
adapter=/opt/bc250-backup-adapter.AgzFbRsD
record=/var/backups/bc250-manual-linked-record.elijj3cy
wiki=bc250-manual-linked-wiki-fixture.service
units=(bc250-linked-gate-fixture-v2.service bc250-linked-studio-fixture-v2.service bc250-linked-client-fixture-v2.service bc250-linked-worker-fixture-v2.service bc250-linked-worker-fixture-v2.socket)
for path in "$fixture" "$envdir" "$adapter" "$record" /var/backups/bc250-model-postfailure.9rv_jqlp; do
  [[ -d $path && ! -L $path && $(stat -c %u "$path") == 0 ]] || { echo '시험 경로 확인 실패' >&2; exit 1; }
done
python3 - "$envdir" "$record" <<'PY'
import json
import os
import re
import stat
import sys
from pathlib import Path
envdir, record = map(Path, sys.argv[1:])
units = {
    '/run/systemd/system/bc250-linked-gate-fixture-v2.service': f'[Service]\nEnvironmentFile={envdir}/gate.env\nExecStart=/opt/bc250-model-control/.venv/bin/python -I -m uvicorn app.gate:create_gate_app --factory --host 127.0.0.1 --port 18883 --workers 1 --no-access-log\nKillMode=control-group\n',
    '/run/systemd/system/bc250-linked-studio-fixture-v2.service': f'[Service]\nEnvironmentFile={envdir}/client.env\nExecStart=/usr/bin/sleep 600\nKillMode=control-group\n',
    '/run/systemd/system/bc250-linked-client-fixture-v2.service': f'[Service]\nEnvironmentFile={envdir}/client.env\nExecStart=/usr/bin/sleep 600\nKillMode=control-group\n',
    '/run/systemd/system/bc250-linked-worker-fixture-v2.service': '[Service]\nExecStart=/usr/bin/sleep 600\nKillMode=control-group\n',
    '/run/systemd/system/bc250-linked-worker-fixture-v2.socket': '[Socket]\nListenStream=127.0.0.1:18884\nAccept=no\n',
    '/etc/systemd/system/bc250-manual-linked-wiki-fixture.service': '[Service]\nExecStart=/usr/bin/sleep infinity\nKillMode=control-group\n',
}
for name, expected in units.items():
    path = Path(name)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or path.read_text() != expected:
        raise SystemExit('시험 unit 확인 실패: ' + path.name)
caddy = Path('/run/systemd/system/bc250-caddy-fixture.service')
info = caddy.lstat()
content = caddy.read_text()
if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
    or 'Description=Disposable Caddy fixture\n' not in content
    or 'ExecStart=/opt/bc250-caddy-linked.p0MPMi7F/caddy run --config /var/backups/bc250-caddy-cycle-8wdcj2rg/' not in content
    or 'KillMode=control-group\n' not in content):
    raise SystemExit('시험 Caddy unit 확인 실패')
rows = [json.loads(line) for line in (record / 'migration-events.jsonl').read_text().splitlines()]
events = [item['event'] for item in rows]
if 'rollback_preserve:begin' not in events or 'rollback_preserve:confirmed' in events or 'rollback_restore:begin' in events:
    raise SystemExit('시험 중단 기록이 예상과 다릅니다.')
print('시험 unit과 중단 단계 확인 완료')
PY
for unit in "${units[@]}" "$wiki"; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == inactive && -z $(systemctl show "$unit" -p Job --value) ]] || { echo "시험 정지 상태 확인 실패: $unit" >&2; exit 1; }
done
archive=$(mktemp -d "$fixture/cleanup.XXXXXXXX")
trap 'echo "시험 정리 중단. 보존 경로: $archive" >&2' ERR
for unit in "${units[@]}" bc250-caddy-fixture.service; do cp -a "/run/systemd/system/$unit" "$archive/$unit"; done
cp -a "/etc/systemd/system/$wiki" "$archive/$wiki"
cp -a "/etc/systemd/system/$wiki.d" "$archive/wiki-dropin"
cp -a /var/lib/bc250-manual-linked-wiki-fixture "$archive/wiki-marker"
python3 - "$adapter" "$record/wiki" <<'PY'
import importlib.util
import sys
from pathlib import Path
adapter, record = map(Path, sys.argv[1:])
spec = importlib.util.spec_from_file_location('fixture_wiki_cleanup', adapter / 'wiki-condition-fence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.UNIT = 'bc250-manual-linked-wiki-fixture.service'
module.PERSISTENT_MARKER = Path('/var/lib/bc250-manual-linked-wiki-fixture')
fence = module.WikiConditionFence(adapter, record, persistent=True)
fence.resume_confirmed()
fence.release(can_release=lambda: True)
print('시험 Wiki 차단 기록 확인 및 이전 실행 상태 복원 완료')
PY
systemctl stop "$wiki" bc250-caddy-fixture.service
for unit in "${units[@]}" bc250-caddy-fixture.service; do mv -- "/run/systemd/system/$unit" "$archive/removed-$unit"; done
mv -- "/etc/systemd/system/$wiki" "$archive/removed-$wiki"
systemctl daemon-reload
echo "시험 unit 정리 완료. 원본 기록과 보존 아카이브 유지: $archive"
