#!/usr/bin/env bash
# Shared archive operation. The production caller must first verify quiescence.
bc250_require_stopped() {
  local unit properties
  for unit in "$@"; do
    properties="$(systemctl show --all "$unit" -p LoadState -p ActiveState -p MainPID -p Job -p KillMode)" || return 1
    properties+=$'\n'
    [[ $properties == *$'LoadState=loaded\n'* && $properties == *$'ActiveState=inactive\n'* \
      && $properties == *$'MainPID=0\n'* && $properties == *$'Job=\n'* \
      && $properties == *$'KillMode=control-group\n'* ]] || {
      echo "서비스의 완전한 정지를 확인하지 못했습니다: $unit" >&2; return 1;
    }
  done
}

bc250_backup_archive() {
  local source_root=$1 backup=$2 caddy_original=$3
  local -a paths=(opt/bc250-ai-studio opt/ai-studio-data
    etc/bc250-ai-studio.env etc/bc250-llm-gate.env etc/bc250-llm-client.env
    etc/systemd/system/bc250-ai-studio.service etc/systemd/system/bc250-llm-gate.service
    etc/systemd/system/bc250-llm-client.service opt/ai/config/active-model.conf
    var/lib/bc250-model-control/legacy-pause.json)
  local path
  for path in "${paths[@]}"; do
    [[ -e $source_root/$path && ! -L $source_root/$path ]] || {
      echo "백업 대상 확인 실패: $path" >&2; return 1;
    }
  done
  cp -a -- "$caddy_original" "$backup/Caddyfile.original"
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
