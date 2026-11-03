#!/usr/bin/env bash
# Fake services and firewall exist only in the isolated Fedora test VM.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
for tool in ip nsenter nft python3 systemd-run; do command -v "$tool" >/dev/null || exit 1; done
records=$(mktemp -d /var/backups/bc250-nft-systemd.XXXXXXXX)
suffix=${records##*.}
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
namespace="bc250-sd-$suffix"
gate="bc250-nft-gate-$suffix.service"
other="bc250-nft-other-$suffix.service"
server_pid=''
trap 'echo "시험 중단. 시험 네임스페이스·unit·기록 보존: $namespace $gate $other $records" >&2' ERR
[[ ! -e /run/netns/$namespace && $(systemctl show "$gate" -p LoadState --value) == not-found && $(systemctl show "$other" -p LoadState --value) == not-found ]] || exit 1
ip netns add "$namespace"
ip -n "$namespace" link set lo up
systemd-run --quiet --unit="$gate" --property=Type=exec /usr/bin/sleep infinity
systemd-run --quiet --unit="$other" --property=Type=exec /usr/bin/sleep infinity
group=$(systemctl show "$gate" -p ControlGroup --value)
other_group=$(systemctl show "$other" -p ControlGroup --value)
[[ $group == "/system.slice/$gate" && $other_group == "/system.slice/$other" ]] || exit 1
nsenter --net="/run/netns/$namespace" python3 -u -c 'from http.server import HTTPServer,BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
 def log_message(self,*args): pass
HTTPServer(("127.0.0.1",18889),H).serve_forever()' >"$records/server.log" 2>&1 &
server_pid=$!
run_client() {
  local path=$1
  nsenter --net="/run/netns/$namespace" bash -c '
    printf "%s\n" "$$" > "/sys/fs/cgroup$1/cgroup.procs"
    exec python3 -c "import urllib.request; r=urllib.request.build_opener(urllib.request.ProxyHandler({})).open(\"http://127.0.0.1:18889/\",timeout=3); assert r.status == 200 and r.read() == b\"ok\""
  ' client "$path" >/dev/null 2>&1
}
ready=no
for _ in {1..60}; do
  if run_client "$group"; then ready=yes; break; fi
  kill -0 "$server_pid" 2>/dev/null || { echo '시험 서버 시작 실패' >&2; false; }
  sleep 0.5
done
[[ $ready == yes ]] || exit 1
run_client "$other_group"
rules="table inet bc250_fixture {
 chain output {
  type filter hook output priority 0; policy accept;
  ip daddr 127.0.0.1 tcp dport 18889 socket cgroupv2 level 2 \"${group#/}\" accept
  ip daddr 127.0.0.1 tcp dport 18889 reject
 }
}"
printf '%s\n' "$rules" | nsenter --net="/run/netns/$namespace" nft --check --file -
printf '%s\n' "$rules" | nsenter --net="/run/netns/$namespace" nft --file -
run_client "$group"
if run_client "$other_group"; then echo '시험 차단 대상 연결 허용' >&2; false; fi
echo '시험 systemd 서비스 cgroup 허용과 다른 서비스 차단 확인'
old_inode=$(stat -Lc '%d:%i' "/sys/fs/cgroup$group")
systemctl restart "$gate"
new_group=$(systemctl show "$gate" -p ControlGroup --value)
[[ $new_group == "$group" && $(systemctl is-active "$gate") == active ]] || exit 1
new_inode=$(stat -Lc '%d:%i' "/sys/fs/cgroup$group")
if [[ $old_inode == "$new_inode" ]]; then
  run_client "$group"
  echo '시험 서비스 재시작 후 기존 cgroup 유지 및 연결 허용 확인'
else
  if run_client "$group"; then echo '새 cgroup이 이전 규칙에 허용됨' >&2; false; fi
  echo '시험 서비스 재시작 후 새 cgroup이 이전 규칙에 거절됨 확인'
fi
if run_client "$other_group"; then echo '재시작 후 시험 차단 대상 연결 허용' >&2; false; fi
printf 'delete table inet bc250_fixture\n%s\n' "$rules" | nsenter --net="/run/netns/$namespace" nft --check --file -
printf 'delete table inet bc250_fixture\n%s\n' "$rules" | nsenter --net="/run/netns/$namespace" nft --file -
run_client "$group"
if run_client "$other_group"; then echo '규칙 갱신 후 시험 차단 대상 연결 허용' >&2; false; fi
echo '시험 규칙 갱신 후 해당 서비스 허용과 다른 서비스 차단 확인'
kill "$server_pid"
wait "$server_pid" 2>/dev/null || true
systemctl stop "$gate" "$other"
ip netns del "$namespace"
trap - ERR
echo "시험 unit과 네임스페이스 정리 완료; 시험 기록 보관: $records"
echo '운영 방화벽·서비스는 변경하지 않았습니다. 기존 연결·다른 네임스페이스·재부팅·GPU는 이 시험의 범위 밖입니다.'
