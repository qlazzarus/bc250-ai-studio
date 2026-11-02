#!/usr/bin/env bash
# Start the existing disposable VM, run the candidate preflight tests, and shut it down.
set -Eeuo pipefail
[[ $(id -u) != 0 && $# == 2 && $2 =~ ^[0-9a-f]{64}$ ]] || {
  echo '일반 사용자로 실행하고 소스 압축 파일과 SHA-256을 전달하세요.' >&2; exit 1;
}
archive=$1
expected=$2
vm_dir="$HOME/bc250-fedora43-test-vm"
test -f "$archive"
printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
test -f "$vm_dir/test-disk.qcow2"
test -f "$vm_dir/seed.iso"
test -f "$vm_dir/vm-key"
test -f "$vm_dir/known_hosts"
available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
[[ $available -ge 3000000 ]] || { echo '사용 가능한 메모리가 부족합니다.' >&2; exit 1; }
[[ -z $(ss -H -ltn 'sport = :22223') ]] || { echo '포트 22223이 사용 중입니다.' >&2; exit 1; }
if [[ -e "$vm_dir/vm.pid" ]]; then
  old_pid=$(cat "$vm_dir/vm.pid")
  [[ $old_pid =~ ^[0-9]+$ ]] || { echo '이전 PID 파일이 유효하지 않습니다.' >&2; exit 1; }
  if kill -0 "$old_pid" 2>/dev/null; then
    echo '이전 PID가 실행 중입니다. 확인 후 진행하세요.' >&2; exit 1
  fi
fi

history=$(mktemp -d "$vm_dir/boot-history.XXXXXXXX")
for name in vm.pid serial.log; do
  if [[ -e "$vm_dir/$name" ]]; then mv -- "$vm_dir/$name" "$history/$name"; fi
done
echo "이전 VM 실행 기록 보관: $history"
trap 'echo "시험이 중단됐습니다. VM과 시험 파일 상태를 보존합니다." >&2' ERR
cd "$vm_dir"
nice -n 15 qemu-system-x86_64 \
  -accel tcg,thread=multi -m 1536 -smp 2 \
  -drive file=test-disk.qcow2,if=virtio,format=qcow2 \
  -drive file=seed.iso,media=cdrom,readonly=on \
  -netdev user,id=net0,restrict=on,hostfwd=tcp:127.0.0.1:22223-:22 \
  -device virtio-net-pci,netdev=net0 -display none -monitor none \
  -serial file:serial.log -pidfile vm.pid -daemonize

ssh_options=(-i "$vm_dir/vm-key" -o BatchMode=yes -o ConnectTimeout=5
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$vm_dir/known_hosts")
ready=no
for attempt in $(seq 1 24); do
  if ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
    'test "$(hostname)" = bc250-fedora43-test && cloud-init status >/dev/null' \
    >/dev/null 2>&1; then
    ready=yes
    break
  fi
  echo "시험 VM 시작 대기 $attempt/24"
  sleep 5
done
[[ $ready == yes ]] || { echo '시험 VM에 접속하지 못했습니다.' >&2; exit 1; }

ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
  'mkdir -m 700 "$HOME/bc250-preflight-systemd-source"'
scp "${ssh_options[@]}" -P 22223 "$archive" \
  vmtest@127.0.0.1:bc250-preflight-systemd-source/source.tar.gz </dev/null
ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
  "set -e; cd \"\$HOME/bc250-preflight-systemd-source\"; \
   printf '%s  %s\\n' '$expected' source.tar.gz | sha256sum -c -; \
   tar -xzf source.tar.gz; \
   sudo bash scripts/test-preflight-systemd-vm.sh \"\$HOME/bc250-preflight-systemd-source\""

echo '시험이 통과해 VM을 정상 종료합니다.'
ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
  'test "$(hostname)" = bc250-fedora43-test && sudo systemctl poweroff' || true
pid=$(cat "$vm_dir/vm.pid")
for attempt in $(seq 1 45); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo '시험 VM 종료 확인'
    free -h
    exit 0
  fi
  sleep 2
done
echo '시험 VM이 아직 종료되지 않았습니다. 강제로 종료하지 않습니다.' >&2
exit 1
