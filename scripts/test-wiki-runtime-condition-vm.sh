#!/usr/bin/env bash
# Probe systemd behavior only in the isolated VM; this is not a deployment tool.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
fixture=$(mktemp -d /var/backups/bc250-wiki-condition.XXXXXXXX)
unit=bc250-wiki-condition-fixture.service
dependent=bc250-wiki-condition-dependent.service
unit_file=/etc/systemd/system/$unit
dependent_file=/etc/systemd/system/$dependent
dropin_dir=/run/systemd/system/$unit.d
marker=$fixture/blocked
for path in "$unit_file" "$dependent_file" "$dropin_dir"; do
  [[ ! -e $path && ! -L $path ]] || exit 1
done
for name in "$unit" "$dependent"; do
  [[ $(systemctl show "$name" -p LoadState --value) == not-found ]] || exit 1
done
trap 'echo "시험 중단. 시험 unit·drop-in과 기록을 보존합니다: $fixture $unit_file $dependent_file $dropin_dir" >&2' ERR
cat > "$unit_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
cat > "$dependent_file" <<EOF
[Unit]
Requires=$unit
After=$unit
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
restorecon -F "$unit_file" "$dependent_file"
systemctl daemon-reload
systemctl start "$unit"
mkdir -m 0755 "$dropin_dir"
touch "$marker"
cat > "$dropin_dir/90-bc250-test.conf" <<EOF
[Unit]
ConditionPathExists=!$marker
EOF
chmod 0644 "$dropin_dir/90-bc250-test.conf"
restorecon -RF "$fixture" "$dropin_dir"
systemctl daemon-reload
systemctl stop "$unit"
systemctl start "$unit" || true
python3 - "$unit" "$fixture/manual-state.json" <<'PY'
import json
import subprocess
import sys
unit, destination = sys.argv[1:]
names = ('LoadState', 'ActiveState', 'MainPID', 'Job', 'ConditionResult', 'NeedDaemonReload', 'FragmentPath', 'DropInPaths', 'Conditions')
text = subprocess.check_output(['/usr/bin/systemctl', 'show', '--all', unit, *['-p' + n for n in names]], text=True)
values = dict(line.split('=', 1) for line in text.splitlines())
if (values.get('LoadState') != 'loaded' or values.get('ActiveState') != 'inactive'
        or values.get('MainPID') != '0' or values.get('Job') != ''
        or values.get('ConditionResult') != 'no' or values.get('NeedDaemonReload') != 'no'):
    raise SystemExit('수동 시작 후 시험 조건 차단 상태가 올바르지 않습니다.')
with open(destination, 'w', encoding='utf-8') as file:
    json.dump(values, file)
print('/etc 시험 unit의 수동 시작 시 runtime 조건 차단 확인', flush=True)
PY
systemctl start "$dependent" || true
[[ $(systemctl show "$unit" -p ActiveState --value) == inactive \
  && $(systemctl show "$unit" -p ConditionResult --value) == no ]] || {
  echo '의존 unit 시작 시 시험 Wiki가 차단되지 않았습니다.' >&2; exit 1;
}
echo '의존 unit이 시작을 요청해도 시험 Wiki의 정지 유지 확인'
systemctl stop "$dependent"
rm -- "$marker"
systemctl start "$unit"
[[ $(systemctl show "$unit" -p ActiveState --value) == active ]] || {
  echo '시험 조건 해제 후 unit이 시작되지 않았습니다.' >&2; exit 1;
}
echo '시험 조건 해제 후 기존 unit 시작 확인'
systemctl stop "$unit"
rm -- "$dropin_dir/90-bc250-test.conf" "$unit_file" "$dependent_file"
rmdir -- "$dropin_dir"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture"
