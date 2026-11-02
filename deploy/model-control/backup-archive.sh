#!/usr/bin/env bash
# Shared archive operation. The production caller must first verify quiescence.
bc250_require_stopped() {
  local unit properties guard_dir
  guard_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P) || return 1
  for unit in "$@"; do
    properties="$(systemctl show --all "$unit" -p LoadState -p ActiveState -p MainPID -p Job -p KillMode -p ControlGroup -p Slice)" || return 1
    properties+=$'\n'
    [[ $properties == *$'LoadState=loaded\n'* && $properties == *$'ActiveState=inactive\n'* \
      && $properties == *$'MainPID=0\n'* && $properties == *$'Job=\n'* \
      && $properties == *$'KillMode=control-group\n'* ]] || {
      echo "서비스의 완전한 정지를 확인하지 못했습니다: $unit" >&2; return 1;
    }
    python3 "$guard_dir/check-service-cgroup.py" "$unit" "$properties" || return 1
  done
}

bc250_backup_archive() {
  local source_root=$1 backup=$2 caddy_original=$3
  local -a paths=(opt/bc250-ai-studio opt/ai-studio-data
    etc/bc250-ai-studio.env etc/bc250-llm-gate.env etc/bc250-llm-client.env
    etc/systemd/system/bc250-ai-studio.service etc/systemd/system/bc250-llm-gate.service
    etc/systemd/system/bc250-llm-client.service opt/ai/config/active-model.conf
    var/lib/bc250-model-control/legacy-pause.json)
  local -a optional_dirs=(etc/systemd/system/bc250-ai-studio.service.d
    etc/systemd/system/bc250-llm-gate.service.d
    etc/systemd/system/bc250-llm-client.service.d)
  local path links
  for path in "${paths[@]}"; do
    [[ -e $source_root/$path && ! -L $source_root/$path ]] || {
      echo "백업 대상 확인 실패: $path" >&2; return 1;
    }
  done
  for path in "${optional_dirs[@]}"; do
    if [[ -e $source_root/$path || -L $source_root/$path ]]; then
      [[ -d $source_root/$path && ! -L $source_root/$path ]] || {
        echo "백업 대상 디렉터리 확인 실패: $path" >&2; return 1;
      }
      links=$(find "$source_root/$path" -type l -print -quit) || return 1
      [[ -z $links ]] || {
        echo "drop-in에 심볼릭 링크가 있어 복구 범위를 확인할 수 없습니다: $path" >&2; return 1;
      }
      paths+=("$path")
    fi
  done
  cp -a -- "$caddy_original" "$backup/Caddyfile.original"
  python3 - "$caddy_original" "$backup/Caddyfile.original" <<'PY'
import os
import stat
import sys

source, saved = sys.argv[1:]
a = os.stat(source, follow_symlinks=False)
b = os.stat(saved, follow_symlinks=False)
if (not stat.S_ISREG(a.st_mode) or not stat.S_ISREG(b.st_mode)
        or (a.st_uid, a.st_gid, a.st_mode) != (b.st_uid, b.st_gid, b.st_mode)):
    raise SystemExit('Caddyfile 소유권 또는 권한이 백업과 다릅니다.')
attrs = set(os.listxattr(source, follow_symlinks=False))
if attrs != set(os.listxattr(saved, follow_symlinks=False)):
    raise SystemExit('Caddyfile 확장 속성 목록이 백업과 다릅니다.')
for attr in attrs:
    if (os.getxattr(source, attr, follow_symlinks=False)
            != os.getxattr(saved, attr, follow_symlinks=False)):
        raise SystemExit('Caddyfile 확장 속성이 백업과 다릅니다.')
PY
  tar --create --file="$backup/legacy.tar" --acls --xattrs --xattrs-include='*' \
    --selinux --numeric-owner --directory="$source_root" -- "${paths[@]}"
  tar --list --file="$backup/legacy.tar" >/dev/null
  (
    cd "$backup"
    sha256sum legacy.tar Caddyfile.original > SHA256SUMS
    sha256sum -c SHA256SUMS >/dev/null
  )
  sync -f "$backup/legacy.tar"
  sync -f "$backup/Caddyfile.original"
  sync -f "$backup/SHA256SUMS"
  sync -f "$backup"
}
