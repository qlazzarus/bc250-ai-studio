#!/usr/bin/env bash
# Exercise only the new fail-closed symlink check with disposable VM files.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/backup-archive.sh \
  && -f $1/deploy/model-control/verify-backup.py ]] || exit 1
source "$1/deploy/model-control/backup-archive.sh"
fixture=$(mktemp -d /var/backups/bc250-dropin-link-test.XXXXXXXX)
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture" >&2' ERR
root=$fixture/source
backup=$fixture/backup
mkdir -p "$root/opt/bc250-ai-studio" "$root/opt/ai-studio-data" \
  "$root/opt/ai/config" "$root/etc/systemd/system" \
  "$root/var/lib/bc250-model-control" "$backup"
printf 'fake\n' > "$root/opt/ai/config/active-model.conf"
printf '{"paused_before_maintenance":false}\n' > "$root/var/lib/bc250-model-control/legacy-pause.json"
for name in bc250-ai-studio bc250-llm-gate bc250-llm-client; do
  printf 'fixture\n' > "$root/etc/$name.env"
  printf 'fixture\n' > "$root/etc/systemd/system/$name.service"
done
dropin=etc/systemd/system/bc250-llm-gate.service.d
mkdir -p "$root/$dropin"
ln -s /etc/fixture-external.conf "$root/$dropin/override.conf"
printf 'fixture\n' > "$fixture/Caddyfile.original"
if bc250_backup_archive "$root" "$backup" "$fixture/Caddyfile.original" 2>"$fixture/error"; then
  echo '링크가 있는 drop-in을 잘못 허용했습니다.' >&2; exit 1
fi
[[ ! -e $backup/legacy.tar && ! -e $backup/Caddyfile.original ]] || {
  echo '링크 검사 전에 백업 파일이 만들어졌습니다.' >&2; exit 1;
}
grep -q '심볼릭 링크' "$fixture/error"
echo 'drop-in 외부 링크를 백업 파일 생성 전에 거절 확인'
python3 - "$1/deploy/model-control/verify-backup.py" "$fixture" <<'PY'
import importlib.util
import sys
import tarfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('verify', sys.argv[1])
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
fixture = Path(sys.argv[2])
with tarfile.open(fixture / 'legacy.tar', 'w') as archive:
    for name in verify.REQUIRED | verify.OPTIONAL_TREES:
        entry = tarfile.TarInfo(name)
        if name in ('opt/bc250-ai-studio', 'opt/ai-studio-data') or name in verify.OPTIONAL_TREES:
            entry.type = tarfile.DIRTYPE
        archive.addfile(entry)
    entry = tarfile.TarInfo('etc/systemd/system/bc250-llm-gate.service.d/override.conf')
    entry.type = tarfile.SYMTYPE
    entry.linkname = '/etc/fixture-external.conf'
    archive.addfile(entry)
verify.checked_file = lambda path: path.open('rb')
try:
    verify.verify_archive(fixture)
except ValueError as exc:
    assert 'drop-in' in str(exc)
else:
    raise SystemExit('복원 검사에서 링크가 있는 아카이브를 허용했습니다.')
print('drop-in 외부 링크가 있는 아카이브의 복원 전 거절 확인')
PY
echo "시험 파일 보관: $fixture"
