#!/usr/bin/env bash
# Only a disposable account and key on the existing isolated Fedora VM.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
work=$(mktemp -d /opt/bc250-ssh-boundary.XXXXXXXX)
chmod 0755 "$work"
suffix=${work##*.}
account="bcs${suffix,,}"
rule="/etc/sudoers.d/$account"
getent passwd "$account" >/dev/null && exit 1
[[ ! -e $rule && ! -e /home/$account ]] || exit 1
trap 'echo "시험 중단. 계정·sudoers와 기록 확인: $account $rule $work" >&2' ERR
useradd -m -s /bin/sh "$account"
# Set an unknown random password hash so OpenSSH does not reject a locked account.
usermod -p "$(openssl rand -base64 48 | openssl passwd -6 -stdin)" "$account"
ssh-keygen -q -t ed25519 -N '' -f "$work/client-key"
cat > "$work/receive" <<'EOF'
#!/bin/sh
[ "$#" -eq 0 ] && [ "$(id -u)" -eq 0 ] || exit 1
printf '%s\n' fixture-receiver-ok
EOF
cat > "$work/forced" <<EOF
#!/bin/sh
[ "\${SSH_ORIGINAL_COMMAND-}" = receive ] || exit 1
exec /usr/bin/sudo -n $work/receive
EOF
chmod 0755 "$work/receive" "$work/forced"
printf '%s ALL=(root) NOPASSWD: %s/receive ""\n' "$account" "$work" > "$rule"
chmod 0440 "$rule"
visudo -cf "$rule" >/dev/null
chown root:root "/home/$account"
chmod 0755 "/home/$account"
install -d -o root -g root -m 0755 "/home/$account/.ssh"
printf 'restrict,command="%s/forced" ' "$work" > "/home/$account/.ssh/authorized_keys"
cat "$work/client-key.pub" >> "/home/$account/.ssh/authorized_keys"
chown root:root "/home/$account/.ssh/authorized_keys"
chmod 0644 "/home/$account/.ssh/authorized_keys"
restorecon -RF "$work" "/home/$account" "$rule"
runuser -u "$account" -- test -r "/home/$account/.ssh/authorized_keys" || {
  echo '시험 계정이 공개키 파일을 읽을 수 없습니다.' >&2; exit 1;
}
awk '{print "127.0.0.1 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub > "$work/known_hosts"
options=(-i "$work/client-key" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=5
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$work/known_hosts" -o PasswordAuthentication=no)
result=$(ssh "${options[@]}" -p 22 "$account@127.0.0.1" receive)
[[ $result == fixture-receiver-ok ]]
echo '시험 공개키 SSH의 고정 명령과 인자 없는 root 명령 연결 확인'
if ssh "${options[@]}" -p 22 "$account@127.0.0.1" 'receive extra' >/dev/null 2>&1; then
  echo '시험 SSH의 임의 인자가 허용됐습니다.' >&2; exit 1
fi
if ssh "${options[@]}" -p 22 "$account@127.0.0.1" /usr/bin/id >/dev/null 2>&1; then
  echo '시험 SSH의 다른 명령이 허용됐습니다.' >&2; exit 1
fi
echo '시험 공개키 SSH의 다른 명령과 임의 인자 거절 확인'
uid=$(id -u "$account")
for ((waited=0; waited<10; waited++)); do
  pgrep -u "$uid" >/dev/null || break
  sleep 1
done
if pgrep -u "$uid" >/dev/null; then
  echo '시험 계정 프로세스가 남아 있어 계정과 sudoers를 보존합니다.' >&2; exit 1
fi
rm -- "$rule"
userdel "$account"
trap - ERR
echo "시험 계정과 sudoers 정리 완료; 시험 키와 기록 보관: $work /home/$account"
echo '실제 후보 수신·Actions 승인·운영 SSH와 권한은 시험하지 않았습니다.'
