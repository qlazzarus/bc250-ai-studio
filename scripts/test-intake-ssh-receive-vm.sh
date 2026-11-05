#!/usr/bin/env bash
# Isolated VM: fixed test candidate and mocked Actions authorization.
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
trap 'echo "시험 중단. 계정·sudoers와 기록 확인: $account $rule $work ${records:-기록없음}" >&2' ERR
useradd -m -s /bin/sh "$account"
source_dir=$1
records=$(mktemp -d /var/backups/bc250-ssh-receive.XXXXXXXX)
install -d -o root -g root -m 0700 "$records/incoming"
install -d -o "$account" -g "$account" -m 0700 "/home/$account/upload"
install -o "$account" -g "$account" -m 0600 "$source_dir/attested-candidate.tar.gz" "/home/$account/upload/candidate.tar.gz"
install -o root -g root -m 0644 "$source_dir/deploy/model-control/intake-authenticated-artifact.py" "$work/intake.py"
uid=$(id -u "$account")
# Set an unknown random password hash so OpenSSH does not reject a locked account.
usermod -p "$(openssl rand -base64 48 | openssl passwd -6 -stdin)" "$account"
ssh-keygen -q -t ed25519 -N '' -f "$work/client-key"
cat > "$work/receive.py" <<EOF
import importlib.util
spec = importlib.util.spec_from_file_location('fixture_intake', '$work/intake.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
commit = 'cc55bb9873b8884410606491e390b76c397f2e5e'
digest = 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8'
receipt = (commit, digest, '41945044035', '1')
module.receive('/home/$account/upload/candidate.tar.gz', '$records/incoming',
    owner=$uid, commit=commit, digest=digest, run_id=receipt[2], attempt=receipt[3],
    verify_authorization=lambda *args: args == receipt)
print('fixture-receiver-ok')
EOF
chmod 0644 "$work/receive.py"
cat > "$work/receive" <<EOF
#!/bin/sh
[ "\$#" -eq 0 ] && [ "\$(id -u)" -eq 0 ] || exit 1
exec /usr/bin/python3 -I $work/receive.py
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
restorecon -RF "$work" "/home/$account" "$rule" "$records"
runuser -u "$account" -- test -r "/home/$account/.ssh/authorized_keys" || {
  echo '시험 계정이 공개키 파일을 읽을 수 없습니다.' >&2; exit 1;
}
awk '{print "127.0.0.1 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub > "$work/known_hosts"
options=(-i "$work/client-key" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=5
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$work/known_hosts" -o PasswordAuthentication=no)
result=$(ssh "${options[@]}" -p 22 "$account@127.0.0.1" receive)
[[ $result == fixture-receiver-ok ]]
echo '시험 공개키 SSH 고정 명령의 실제 후보 root 수신 및 해시 확인'
if ssh "${options[@]}" -p 22 "$account@127.0.0.1" receive >/dev/null 2>&1; then
  echo '기존 수신 후보를 덮어쓸 수 있었습니다.' >&2; exit 1
fi
printf '%s  %s\n' 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8' "$records/incoming/candidate.tar.gz" | sha256sum -c -
echo '동일 시험 후보 재수신 시 기존 파일 덮어쓰기 거절 확인'
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
echo "시험 수신 파일 보관: $records"
echo 'Actions 승인 전달·실제 후보의 SSH 업로드·운영 SSH와 권한은 시험하지 않았습니다.'
