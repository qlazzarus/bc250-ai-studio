#!/usr/bin/env bash
# Test a cooperating process passing an unconnected socket across cgroups.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
for tool in ip nsenter nft python3 setpriv; do command -v "$tool" >/dev/null || exit 1; done
[[ $(stat -fc %T /sys/fs/cgroup) == cgroup2fs && -w /sys/fs/cgroup ]] || exit 1
records=$(mktemp -d /var/backups/bc250-nft-transfer.XXXXXXXX)
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
uid=$(id -u nobody)
gid=$(id -g nobody)
run_client() {
  local subgroup=$1
  nsenter --net="/run/netns/$namespace" bash -c '
    printf "%s\n" "$$" > "$1/cgroup.procs"
    exec setpriv --reuid="$2" --regid="$3" --clear-groups python3 -c "import urllib.request; r=urllib.request.build_opener(urllib.request.ProxyHandler({})).open(\"http://127.0.0.1:18889/\",timeout=3); assert r.status == 200 and r.read() == b\"ok\""
  ' client "$group/$subgroup" "$uid" "$gid" >/dev/null 2>&1
}
ready=no
for _ in {1..60}; do
  if run_client gate; then ready=yes; break; fi
  kill -0 "$server_pid" 2>/dev/null || { echo '시험 서버 시작 실패' >&2; false; }
  sleep 0.5
done
[[ $ready == yes ]] || { echo '시험 서버 준비 시간 초과' >&2; false; }
run_client other
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
if run_client other; then echo '다른 시험 cgroup이 직접 연결됐습니다.' >&2; false; fi
echo '같은 비특권 UID의 허용 cgroup 연결과 다른 cgroup 직접 연결 거절 확인'
nsenter --net="/run/netns/$namespace" python3 - "$group" "$uid" "$gid" "$records" <<'PY'
import array
import errno
import json
import os
import socket
import sys
from pathlib import Path

group, uid, gid, records = Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4])
left, right = socket.socketpair()
read_fd, write_fd = os.pipe()

def join(name):
    (group / name / 'cgroup.procs').write_text(str(os.getpid()) + '\n')
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)

sender = os.fork()
if sender == 0:
    try:
        right.close()
        join('gate')
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as outgoing:
            left.sendmsg([b'f'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                    array.array('i', [outgoing.fileno()]))])
        os._exit(0)
    except BaseException:
        os._exit(1)

receiver = os.fork()
if receiver == 0:
    try:
        left.close()
        os.close(read_fd)
        join('other')
        msg, ancillary, flags, _ = right.recvmsg(1, socket.CMSG_SPACE(array.array('i').itemsize))
        assert msg == b'f' and not flags
        descriptors = array.array('i')
        for level, kind, data in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                descriptors.frombytes(data[:len(data) - len(data) % descriptors.itemsize])
        assert len(descriptors) == 1
        with socket.socket(fileno=descriptors[0]) as outgoing:
            outgoing.settimeout(5)
            result = outgoing.connect_ex(('127.0.0.1', 18889))
        os.write(write_fd, str(result).encode('ascii'))
        os._exit(0)
    except BaseException:
        os._exit(1)

left.close()
right.close()
os.close(write_fd)
raw = os.read(read_fd, 32)
os.close(read_fd)
for pid in (sender, receiver):
    _, status = os.waitpid(pid, 0)
    if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
        raise SystemExit('시험 프로세스가 완료되지 않았습니다.')
if not raw.isdigit():
    raise SystemExit('전달받은 소켓의 시험 결과가 없습니다.')
result = int(raw)
if result == 0:
    outcome = '허용'
elif result in (errno.ECONNREFUSED, errno.EACCES, errno.EPERM):
    outcome = '거절'
else:
    raise SystemExit('예상하지 못한 소켓 오류: ' + str(result))
(records / 'result.json').write_text(json.dumps({'transferred_socket': outcome}, ensure_ascii=False) + '\n')
print('허용 cgroup이 생성해 다른 cgroup에 전달한 미연결 소켓:', outcome, flush=True)
PY
kill "$server_pid"
wait "$server_pid" 2>/dev/null || true
server_pid=''
ip netns del "$namespace"
rmdir "$group/gate" "$group/other" "$group"
trap - ERR
echo "시험 자원 정리 완료; 기록 보관: $records"
echo '운영 방화벽·서비스는 변경하지 않았습니다. 협조한 같은 UID 프로세스 사이의 시험이며 임의 소켓 탈취 가능성이나 실제 gate 동작은 확인하지 않았습니다.'
