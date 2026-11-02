#!/usr/bin/env bash
# Inspect disposable evidence archives; never modify operational services or data.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 1 && -f $1/deploy/model-control/check-preserved-switch-state.py ]] || exit 1
source "$1/deploy/model-control/preserve-new-archive.sh"
fixture=$(mktemp -d /var/backups/bc250-preserved-check.XXXXXXXX)
toolsdir=$(mktemp -d /opt/bc250-preserved-tools.XXXXXXXX)
chmod 0755 "$toolsdir"
for name in check-preserved-switch-state.py check-new-switch-state.py; do
  install -o root -g root -m 0644 "$1/deploy/model-control/$name" "$toolsdir/$name"
done
restorecon -RF "$toolsdir"
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture $toolsdir" >&2' ERR
root=$fixture/source
mkdir -p "$root/var/lib/bc250-model-control" "$root/var/lib/bc250-llm-gate" \
  "$root/opt/ai-studio-data" "$root/etc/bc250-model-control" "$fixture/good" "$fixture/pending"
printf '{}\n' > "$root/var/lib/bc250-model-control/switch.json"
printf '{"holds":["startup","legacy"]}\n' > "$root/var/lib/bc250-llm-gate/holds.json"
printf 'fixture studio data\n' > "$root/opt/ai-studio-data/data.db"
printf 'fixture key\n' > "$root/etc/bc250-model-control/api-key"
python3 - "$root/var/lib/bc250-model-control/operations.sqlite3" succeeded <<'PY'
import sqlite3
import sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('create table switch_operations (state text not null)')
    db.execute('insert into switch_operations values (?)', (sys.argv[2],))
PY
restorecon -RF "$root"
bc250_preserve_new_archive "$root" "$fixture/good"
python3 - "$root/var/lib/bc250-model-control/operations.sqlite3" <<'PY'
import sqlite3
import sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute("insert into switch_operations values ('recovery_required')")
PY
bc250_preserve_new_archive "$root" "$fixture/pending"
python3 - "$toolsdir" "$fixture" <<'PY'
import importlib.util
import sys
from pathlib import Path

tools, fixture = map(Path, sys.argv[1:])
spec = importlib.util.spec_from_file_location('check_evidence', tools / 'check-preserved-switch-state.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
checker = tools / 'check-new-switch-state.py'
assert module.check(fixture / 'good', checker)
try:
    module.check(fixture / 'pending', checker)
except ValueError:
    pass
else:
    raise SystemExit('보존 아카이브의 미완료 작업을 잘못 허용했습니다.')
print('보존 아카이브의 완료 상태 확인과 미완료 작업 거절 확인', flush=True)
archive = fixture / 'good/new-state.tar'
with archive.open('ab') as file:
    file.write(b'fixture corruption')
try:
    module.check(fixture / 'good', checker)
except ValueError:
    pass
else:
    raise SystemExit('변조된 아카이브를 잘못 허용했습니다.')
print('보존 아카이브 변조 시 검사 전 거절 확인', flush=True)
PY
echo "시험 파일 보관: $fixture $toolsdir"
