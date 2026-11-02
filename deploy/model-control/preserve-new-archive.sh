#!/usr/bin/env bash
# Shared candidate: caller must stop writers and create a private destination.
bc250_preserve_new_archive() {
  local source_root=$1 evidence=$2 path
  local -a paths=(var/lib/bc250-model-control var/lib/bc250-llm-gate
    opt/ai-studio-data etc/bc250-model-control)
  for path in "${paths[@]}"; do
    [[ -d $source_root/$path && ! -L $source_root/$path ]] || {
      echo "신규 상태 디렉터리 확인 실패: $path" >&2; return 1;
    }
  done
  for path in var/lib/bc250-model-control/switch.json var/lib/bc250-llm-gate/holds.json; do
    [[ -f $source_root/$path && ! -L $source_root/$path ]] || {
      echo "신규 상태 파일 확인 실패: $path" >&2; return 1;
    }
  done
  [[ -d $evidence && ! -L $evidence && $(stat -c '%u %a' "$evidence") == '0 700' ]] || {
    echo '신규 상태 보존 디렉터리를 확인하지 못했습니다.' >&2; return 1;
  }
  [[ ! -e $evidence/new-state.tar && ! -L $evidence/new-state.tar ]] || return 1
  tar --create --file="$evidence/new-state.tar" --acls --xattrs --xattrs-include='*' \
    --selinux --numeric-owner --directory="$source_root" -- "${paths[@]}" || return 1
  tar --list --file="$evidence/new-state.tar" >/dev/null || return 1
  tar --compare --file="$evidence/new-state.tar" --directory="$source_root" || return 1
  (
    cd "$evidence"
    sha256sum new-state.tar > NEW-STATE-SHA256SUMS
    sha256sum -c NEW-STATE-SHA256SUMS >/dev/null
  ) || return 1
  sync -f "$evidence/new-state.tar" || return 1
  sync -f "$evidence/NEW-STATE-SHA256SUMS" || return 1
  sync -f "$evidence" || return 1
}
