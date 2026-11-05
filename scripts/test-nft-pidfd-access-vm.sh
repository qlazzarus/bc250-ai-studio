#!/usr/bin/env bash
# Test same-UID sibling pidfd access to a non-cooperating socket owner.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && ( $# == 1 || $# == 2 ) ]] || exit 1
mode=${2:-same-uid}
[[ $mode == same-uid || $mode == separate-uid ]] || exit 1
for tool in ip nsenter nft python3 setpriv; do command -v "$tool" >/dev/null || exit 1; done
[[ $(stat -fc %T /sys/fs/cgroup) == cgroup2fs && -w /sys/fs/cgroup ]] || exit 1
records=$(mktemp -d /var/backups/bc250-nft-pidfd.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
namespace="bc250-fd-$suffix"
group_name="bc250_fd_$suffix"
group="/sys/fs/cgroup/$group_name"
[[ ! -e /run/netns/$namespace && ! -L /run/netns/$namespace \
  && ! -e $group && ! -L $group ]] || exit 1
server_pid=''
failure() {
  if [[ -n $server_pid ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  echo "시험 중단. 네임스페이스·cgroup·기록 보존: $namespace $group $records" >&2
}
trap failure ERR
mkdir "$group" "$group/gate" "$group/other"
ip netns add "$namespace"
ip -n "$namespace" link set lo up
nsenter --net="/run/netns/$namespace" python3 -u -c 'from http.server import HTTPServer,BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
 def do_GET(self): self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
 def log_message(self,*args): pass
HTTPServer(("127.0.0.1",18889),H).serve_forever()' >"$records/server.log" 2>&1 &
server_pid=$!
if [[ $mode == separate-uid ]]; then
  uid=$(id -u ai-gate)
  gid=$(id -g ai-gate)
  caller_uid=$(id -u ai-studio)
  caller_gid=$(id -g ai-studio)
  [[ $uid != "$caller_uid" ]] || { echo '시험 계정 UID가 같습니다.' >&2; exit 1; }
else
  uid=$(id -u nobody)
  gid=$(id -g nobody)
  caller_uid=$uid
  caller_gid=$gid
fi
run_client() {
  local subgroup=$1 client_uid=$2 client_gid=$3
  nsenter --net="/run/netns/$namespace" bash -c '
    printf "%s\n" "$$" > "$1/cgroup.procs"
    exec setpriv --reuid="$2" --regid="$3" --clear-groups python3 -c "import urllib.request; r=urllib.request.build_opener(urllib.request.ProxyHandler({})).open(\"http://127.0.0.1:18889/\",timeout=3); assert r.status == 200 and r.read() == b\"ok\""
  ' client "$group/$subgroup" "$client_uid" "$client_gid" >/dev/null 2>&1
}
ready=no
for _ in {1..60}; do
  if run_client gate "$uid" "$gid"; then ready=yes; break; fi
  kill -0 "$server_pid" 2>/dev/null || { echo '시험 서버 시작 실패' >&2; false; }
  sleep 0.5
done
[[ $ready == yes ]] || { echo '시험 서버 준비 시간 초과' >&2; false; }
run_client other "$caller_uid" "$caller_gid"
rules="table inet bc250_fixture {
 chain output {
  type filter hook output priority 0; policy accept;
  ip daddr 127.0.0.1 tcp dport 18889 socket cgroupv2 level 2 \"$group_name/gate\" accept
  ip daddr 127.0.0.1 tcp dport 18889 reject
 }
}"
printf '%s\n' "$rules" | nsenter --net="/run/netns/$namespace" nft --check --file -
printf '%s\n' "$rules" | nsenter --net="/run/netns/$namespace" nft --file -
run_client gate "$uid" "$gid"
if run_client other "$caller_uid" "$caller_gid"; then echo '다른 시험 cgroup이 직접 연결됐습니다.' >&2; false; fi
echo '허용 cgroup 연결과 다른 cgroup 직접 연결 거절 확인'
nsenter --net="/run/netns/$namespace" python3 \
  "$1/scripts/test-nft-pidfd-access.py" "$group" "$uid" "$gid" "$caller_uid" "$caller_gid" "$records"
kill "$server_pid"
wait "$server_pid" 2>/dev/null || true
server_pid=''
ip netns del "$namespace"
rmdir "$group/gate" "$group/other" "$group"
trap - ERR
echo "시험 자원 정리 완료; 기록 보관: $records"
echo '운영 방화벽·서비스는 변경하지 않았습니다. 비협조 시험 프로세스만 검사했으며 운영 정책·실제 gate·다른 접근 경로는 확인하지 않았습니다.'
