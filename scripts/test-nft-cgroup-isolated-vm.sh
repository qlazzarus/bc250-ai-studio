#!/usr/bin/env bash
# Only a disposable QEMU VM and a new network namespace are used.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
for tool in ip nsenter nft python3; do
  command -v "$tool" >/dev/null || { echo "시험 VM 도구 없음: $tool" >&2; exit 1; }
done
[[ $(stat -fc %T /sys/fs/cgroup) == cgroup2fs && -w /sys/fs/cgroup ]] || {
  echo '시험 VM의 쓰기 가능한 cgroup v2가 필요합니다.' >&2; exit 1;
}
records=$(mktemp -d /var/backups/bc250-nft-cgroup.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
namespace="bc250-nft-$suffix"
group_name="bc250_nft_$suffix"
group="/sys/fs/cgroup/$group_name"
[[ ! -e /run/netns/$namespace && ! -L /run/netns/$namespace && ! -e $group && ! -L $group ]] || exit 1
server_pid=''
stream_pid=''
failure() {
  if [[ -n $stream_pid ]] && kill -0 "$stream_pid" 2>/dev/null; then
    kill "$stream_pid" 2>/dev/null || true
    wait "$stream_pid" 2>/dev/null || true
  fi
  if [[ -n $server_pid ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  echo "시험 중단. 시험 네임스페이스·cgroup·기록 보존: $namespace $group $records" >&2
}
trap failure ERR
mkdir "$group" "$group/gate" "$group/other"
ip netns add "$namespace"
ip -n "$namespace" link set lo up
host_net=$(readlink /proc/self/ns/net)
test_net=$(nsenter --net="/run/netns/$namespace" readlink /proc/self/ns/net)
[[ $host_net != "$test_net" ]] || { echo '별도 시험 네트워크 네임스페이스 확인 실패' >&2; false; }
host_group=$(stat -Lc '%d:%i' "$group/gate")
test_group=$(nsenter --net="/run/netns/$namespace" stat -Lc '%d:%i' "$group/gate")
[[ $host_group == "$test_group" ]] || { echo '시험 cgroup 경로 확인 실패' >&2; false; }
nsenter --net="/run/netns/$namespace" python3 -u -c '
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import time
release = Path(sys.argv[1]) / "stream-release"
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        if self.path == "/stream":
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"1")
            self.wfile.flush()
            end = time.monotonic() + 90
            while not release.exists() and time.monotonic() < end:
                time.sleep(0.05)
            if release.exists():
                self.wfile.write(b"2")
                self.wfile.flush()
            return
        self.end_headers()
        self.wfile.write(b"ok")
    def log_message(self, *args):
        pass
ThreadingHTTPServer(("127.0.0.1", 18889), Handler).serve_forever()
' "$records" >"$records/server.log" 2>&1 &
server_pid=$!
run_client() {
  local subgroup=$1
  nsenter --net="/run/netns/$namespace" bash -c '
    printf "%s\n" "$$" > "$1/cgroup.procs"
    exec python3 -c "import urllib.request; o=urllib.request.build_opener(urllib.request.ProxyHandler({})); r=o.open(\"http://127.0.0.1:18889/\", timeout=3); assert r.status == 200 and r.read() == b\"ok\""
  ' client "$group/$subgroup" >/dev/null 2>&1
}
ready=no
for _ in {1..60}; do
  if run_client gate; then ready=yes; break; fi
  kill -0 "$server_pid" 2>/dev/null || { echo '시험 서버가 시작되지 않았습니다.' >&2; false; }
  sleep 0.5
done
[[ $ready == yes ]] || { echo '시험 서버 준비 시간이 초과됐습니다.' >&2; false; }
run_client other
echo '별도 네트워크 네임스페이스에서 같은 UID의 두 시험 프로세스 연결 확인'
nsenter --net="/run/netns/$namespace" bash -c '
  printf "%s\n" "$$" > "$1/cgroup.procs"
  exec python3 -c "import pathlib,sys,urllib.request; p=pathlib.Path(sys.argv[1]); o=urllib.request.build_opener(urllib.request.ProxyHandler({})); r=o.open(\"http://127.0.0.1:18889/stream\", timeout=45); assert r.read(1) == b\"1\"; (p / \"stream-ready\").touch(); assert r.read(1) == b\"2\"" "$2"
' client "$group/other" "$records" >"$records/stream.log" 2>&1 &
stream_pid=$!
stream_ready=no
for _ in {1..60}; do
  if [[ -f $records/stream-ready ]]; then stream_ready=yes; break; fi
  kill -0 "$stream_pid" 2>/dev/null || { echo '시험 기존 연결이 시작되지 않았습니다.' >&2; false; }
  sleep 0.5
done
[[ $stream_ready == yes ]] || { echo '시험 기존 연결 준비 시간이 초과됐습니다.' >&2; false; }
rules="table inet bc250_fixture {
 chain output {
  type filter hook output priority 0; policy accept;
  ip daddr 127.0.0.1 tcp dport 18889 socket cgroupv2 level 2 \"$group_name/gate\" accept
  ip daddr 127.0.0.1 tcp dport 18889 reject
 }
}"
printf '%s\n' "$rules" | nsenter --net="/run/netns/$namespace" nft --check --file -
printf '%s\n' "$rules" | nsenter --net="/run/netns/$namespace" nft --file -
run_client gate
if run_client other; then
  echo '시험 차단 대상의 연결이 허용됐습니다.' >&2
  false
fi
run_client gate
echo '같은 UID에서도 시험 gate cgroup 허용 및 다른 cgroup 차단 확인'
touch "$records/stream-release"
if wait "$stream_pid"; then
  echo '차단 전 시작된 시험 연결에서 차단 후 응답 수신 확인'
else
  echo '차단 전 시작된 시험 연결의 차단 후 응답 수신 실패 또는 시간 초과'
fi
stream_pid=''
old_group=$(stat -Lc '%d:%i' "$group/gate")
rmdir "$group/gate"
mkdir "$group/gate"
new_group=$(stat -Lc '%d:%i' "$group/gate")
[[ $old_group != "$new_group" ]] || { echo '시험 cgroup 재생성을 구별하지 못했습니다.' >&2; false; }
kill -0 "$server_pid" 2>/dev/null || { echo '시험 서버가 실행 중이 아닙니다.' >&2; false; }
if run_client gate; then
  echo '재생성된 시험 cgroup이 기존 허용 규칙에 잘못 일치했습니다.' >&2
  false
fi
echo '동일 경로의 시험 cgroup 재생성 후 기존 허용 규칙에 일치하지 않음 확인'
kill "$server_pid"
wait "$server_pid" 2>/dev/null || true
server_pid=''
ip netns del "$namespace"
rmdir "$group/gate" "$group/other" "$group"
trap - ERR
echo "시험 네임스페이스·cgroup 정리 완료; 기록 보관: $records"
echo '운영 방화벽은 변경하지 않았고 다른 네임스페이스·재부팅·GPU는 시험하지 않았습니다.'
