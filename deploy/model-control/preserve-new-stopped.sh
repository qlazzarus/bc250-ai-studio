#!/usr/bin/env bash
# Candidate only: preserve stopped new state; never stop, restore or start services.
set -Eeuo pipefail
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
[[ $(id -u) == 0 && $# == 0 ]] || { echo 'root로 인자 없이 실행하세요.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
python3 - "$script_dir" <<'PY'
import os
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
for path in (root / 'backup-archive.sh', root / 'check-service-cgroup.py',
             root / 'preserve-new-archive.sh'):
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise SystemExit('보존 도구의 경로를 신뢰할 수 없습니다.')
        if item != path and not stat.S_ISDIR(info.st_mode):
            raise SystemExit('보존 도구 상위 경로가 디렉터리가 아닙니다.')
    if not stat.S_ISREG(path.stat().st_mode) or path.stat().st_nlink != 1:
        raise SystemExit('보존 도구는 단일 링크의 일반 파일이어야 합니다.')
PY
source "$script_dir/backup-archive.sh"
source "$script_dir/preserve-new-archive.sh"
units=(bc250-ai-studio.service bc250-llm-gate.service bc250-llm-client.service
  bc250-model-worker.service bc250-model-api.service)
bc250_require_stopped "${units[@]}"
require_socket_stopped() {
  local socket_state
  socket_state=$(systemctl show --all bc250-model-worker.socket -p LoadState -p ActiveState -p Job) || return 1
  socket_state+=$'\n'
  [[ $socket_state == *$'LoadState=loaded\n'* && $socket_state == *$'ActiveState=inactive\n'* \
    && $socket_state == *$'Job=\n'* ]] || {
    echo '작업자 소켓이 완전히 정지되지 않았습니다.' >&2; return 1;
  }
}
require_socket_stopped
[[ -d /var/backups && ! -L /var/backups && $(stat -c '%u %a' /var/backups) == '0 755' ]] || {
  echo '신규 상태 보존 상위 경로를 확인하지 못했습니다.' >&2; exit 1;
}
evidence=$(mktemp -d /var/backups/bc250-model-postfailure.XXXXXXXX)
echo "신규 상태 보존 경로: $evidence"
trap 'echo "신규 상태 보존 미완료. 해당 디렉터리와 서비스를 보존하고 조사하세요." >&2' ERR
for unit in "${units[@]}" bc250-model-worker.socket llama-server.service; do
  systemctl show --all "$unit" -p LoadState -p ActiveState -p SubState -p Job \
    -p MainPID -p Result -p ControlGroup > "$evidence/$unit.status"
done
journalctl --no-pager --boot --output=short-iso \
  -u bc250-ai-studio.service -u bc250-llm-gate.service -u bc250-llm-client.service \
  -u bc250-model-worker.service -u bc250-model-api.service -u llama-server.service \
  > "$evidence/systemd-journal.log"
bc250_require_stopped "${units[@]}"
require_socket_stopped
bc250_preserve_new_archive / "$evidence"
(
  cd "$evidence"
  sha256sum -- *.status systemd-journal.log > SYSTEMD-SHA256SUMS
  sha256sum -c SYSTEMD-SHA256SUMS >/dev/null
)
for path in "$evidence"/*.status "$evidence/systemd-journal.log" "$evidence/SYSTEMD-SHA256SUMS"; do
  sync -f "$path"
done
sync -f "$evidence"
echo '신규 journal·gate 상태·설정·Studio 데이터와 systemd 기록 보존 완료; 서비스를 변경하지 않았습니다.'
