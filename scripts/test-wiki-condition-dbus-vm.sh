#!/usr/bin/env bash
# Discover systemd's structured condition representation on a disposable VM unit.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
fixture=$(mktemp -d /var/backups/bc250-wiki-condition-dbus.XXXXXXXX)
unit=bc250-wiki-dbus-fixture-v2.service
unit_file=/etc/systemd/system/$unit
dropin_dir=/run/systemd/system/$unit.d
marker=$fixture/blocked
for path in "$unit_file" "$dropin_dir"; do
  [[ ! -e $path && ! -L $path ]] || exit 1
done
[[ $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $fixture $unit_file $dropin_dir" >&2' ERR
cat > "$unit_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
KillMode=control-group
EOF
restorecon -F "$unit_file"
systemctl daemon-reload
# Keep the disposable unit active so systemd cannot garbage-collect it between
# the separate busctl connections. Reloading a condition does not start Wiki.
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
[[ $(systemctl show "$unit" -p ActiveState --value) == active ]] || exit 1
python3 - "$unit" "$marker" "$fixture/condition-property.json" <<'PY'
import json
import subprocess
import sys

unit, marker, evidence = sys.argv[1:]
def bus(*args):
    output = subprocess.check_output(['/usr/bin/busctl', '--system', '--json=short', '--no-pager', *args],
                                     text=True, timeout=15)
    return json.loads(output)
obj = bus('call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1',
          'org.freedesktop.systemd1.Manager', 'GetUnit', 's', unit)
data = obj.get('data')
if isinstance(data, list) and len(data) == 1:
    data = data[0]
if obj.get('type') != 'o' or not isinstance(data, str) or not data.startswith('/org/freedesktop/systemd1/unit/'):
    raise SystemExit('시험 unit D-Bus 경로를 확인하지 못했습니다.')
condition = bus('get-property', 'org.freedesktop.systemd1', data,
                'org.freedesktop.systemd1.Unit', 'Conditions')
encoded = json.dumps(condition, ensure_ascii=True, separators=(',', ':'))
if marker not in encoded:
    raise SystemExit('시험 조건의 marker가 D-Bus 응답에 없습니다.')
with open(evidence, 'w', encoding='utf-8') as file:
    file.write(encoded + '\n')
print('시험 조건 D-Bus 속성:', encoded, flush=True)
print('가짜 시험 unit을 실행한 상태에서 속성만 조회했습니다.', flush=True)
PY
systemctl stop "$unit"
rm -- "$dropin_dir/90-bc250-test.conf" "$unit_file"
rmdir -- "$dropin_dir"
systemctl daemon-reload
echo "시험 unit 정리 완료; 시험 기록 보관: $fixture"
