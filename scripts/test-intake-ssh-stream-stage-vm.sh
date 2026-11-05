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
trap 'echo "시험 중단. 계정·sudoers와 기록 확인: $account $rule $work ${records:-기록없음} ${stage:-스테이징없음}" >&2' ERR
useradd -m -s /bin/sh "$account"
source_dir=$1
records=$(mktemp -d /var/backups/bc250-ssh-receive.XXXXXXXX)
install -d -o root -g root -m 0700 "$records/incoming"
install -d -o "$account" -g "$account" -m 0700 "/home/$account/upload"
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
cat > "$work/upload.py" <<EOF
import os
import sys
if os.environ.get('SSH_ORIGINAL_COMMAND') != 'receive':
    raise SystemExit(1)
base = '/home/$account/upload'
directory = os.open(base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    fd = os.open('candidate.incomplete', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
    with os.fdopen(fd, 'wb') as out:
        count = 0
        while chunk := sys.stdin.buffer.read(1024 * 1024):
            count += len(chunk)
            if count > 1024 * 1024 * 1024:
                raise ValueError('시험 업로드 크기 초과')
            out.write(chunk)
        if count == 0:
            raise ValueError('빈 시험 업로드')
        out.flush()
        os.fsync(out.fileno())
    os.link('candidate.incomplete', 'candidate.tar.gz', src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
    os.fsync(directory)
    os.unlink('candidate.incomplete', dir_fd=directory)
    os.fsync(directory)
finally:
    os.close(directory)
os.execv('/usr/bin/sudo', ['/usr/bin/sudo', '-n', '$work/receive'])
EOF
chmod 0644 "$work/upload.py"
cat > "$work/forced" <<EOF
#!/bin/sh
exec /usr/bin/python3 -I $work/upload.py
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
result=$(ssh "${options[@]}" -p 22 "$account@127.0.0.1" receive < "$source_dir/attested-candidate.tar.gz")
[[ $result == fixture-receiver-ok ]]
echo '시험 공개키 SSH 표준입력으로 후보 업로드와 root 수신·해시 확인'
stage=$(mktemp -d /opt/bc250-release.XXXXXXXX)
rmdir "$stage"
python3 - "$source_dir" "$records/incoming/candidate.tar.gz" "$stage" <<'PYCODE'
import hashlib
import importlib.util
import sys
import tarfile
from pathlib import Path
sys.dont_write_bytecode = True
source, archive, stage = map(Path, sys.argv[1:])
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
base = source / 'deploy/model-control'
stager = load('fixture_stage', base / 'stage-release.py')
verifier = load('fixture_archive', base / 'verify-release-candidate.py')
tree = load('fixture_tree', base / 'verify-staged-release.py')
pinned = load('fixture_pinned', base / 'assemble-pinned-coordinator.py')
commit = 'cc55bb9873b8884410606491e390b76c397f2e5e'
digest = 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8'
def verify_archive(path, value, revision):
    verifier.verify(path, value, revision)
    return True
def verify_stage(path, revision, value):
    return tree.StagedReleaseCheck(archive, path, revision, value)(revision, value)
stager.stage(archive, stage, commit, digest, verify_archive=verify_archive, verify_stage=verify_stage)
bootstrap_name = 'deploy/model-control/verify-staged-release.py'
with tarfile.open(archive, 'r:gz') as tar:
    with tar.extractfile(bootstrap_name) as stream:
        bootstrap_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
# This provenance callback is only a fixture; it does not authenticate Actions.
checker = pinned.authenticated_checker(root=stage, archive=archive,
    bootstrap_checker=stage / bootstrap_name, bootstrap_sha256=bootstrap_hash,
    commit=commit, artifact_sha256=digest,
    verify_provenance=lambda revision, value: (revision, value) == (commit, digest))
if checker(commit, digest) is not True:
    raise SystemExit('시험 릴리스 검사 실패')
print('SSH 스트림 수신 후보의 실제 스테이징·릴리스 조립 검사 연결 확인', flush=True)
print(f'시험 스테이징 보관: {stage}', flush=True)
PYCODE
if ssh "${options[@]}" -p 22 "$account@127.0.0.1" receive < "$source_dir/attested-candidate.tar.gz" >/dev/null 2>&1; then
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
echo 'Actions 승인 전달·외부 runner SSH·운영 SSH와 권한은 시험하지 않았습니다.'
