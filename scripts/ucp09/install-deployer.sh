#!/usr/bin/env bash
# Stage the reviewed release installer onto the BC-250 host and verify it.
#
# The deploy workflow refuses to upload a release unless
# /usr/local/sbin/bc250-ai-studio-deploy is byte-identical to
# deploy/deploy-release.sh ("Install the reviewed deploy/deploy-release.sh on the
# server first."). Any change to the installer therefore has to be installed on
# the host before CI can deploy.
#
# Staging and hashing need no privileges. Only the final install does, and the
# deploy user has no NOPASSWD rule for it, so this script stops there and prints
# the step (or runs it with --apply, which prompts for the sudo password).
#
#   scripts/ucp09/install-deployer.sh             # stage + verify, print the step
#   scripts/ucp09/install-deployer.sh --apply     # stage, verify, then install
#
# Override the target with UCP09_SSH / UCP09_KEY / UCP09_PORT.
set -eu

SSH_TARGET=${UCP09_SSH:-yeppyshiba@yeppyshiba.iptime.org}
SSH_PORT=${UCP09_PORT:-2222}
SSH_KEY=${UCP09_KEY:-$HOME/.ssh/bc250_studio_maintenance}

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
INSTALLER=deploy/deploy-release.sh
TARGET_PATH=/usr/local/sbin/bc250-ai-studio-deploy
STAGE_DIR=.cache/bc250-deployer
STAGED=$STAGE_DIR/bc250-ai-studio-deploy.new

apply=false
case ${1:-} in
    --apply) apply=true ;;
    '') ;;
    *) echo "usage: $0 [--apply]" >&2; exit 2 ;;
esac

hash_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; }

# CI hashes the file in the commit it builds, so the reference is the committed
# object, not the working tree.
desired=$(git -C "$ROOT" show "HEAD:$INSTALLER" | hash_of | cut -d' ' -f1)
worktree=$(hash_of < "$ROOT/$INSTALLER" | cut -d' ' -f1)
if [ "$worktree" != "$desired" ]; then
    echo "refusing: $INSTALLER has uncommitted changes." >&2
    echo "CI checks the committed copy ($desired), so commit the installer first." >&2
    exit 1
fi

remote() { ssh -i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes "$SSH_TARGET" "$@"; }

installed=$(remote "sha256sum $TARGET_PATH" | cut -d' ' -f1)
echo "repo $INSTALLER = $desired"
echo "host installed  = $installed"
if [ "$installed" = "$desired" ]; then
    echo "already in sync; nothing to install."
    exit 0
fi

# A root-run script keeps the privileged step to one command with no nested
# quoting. It re-checks the hash itself so a tampered transfer cannot install.
installer=$(mktemp)
trap 'rm -f "$installer"' EXIT
cat > "$installer" <<'ROOT_SCRIPT'
set -eu
staged=$1; desired=$2; target=$3
actual=$(sha256sum -- "$staged" | cut -d' ' -f1)
[ "$actual" = "$desired" ] || {
    echo "Refusing: staged installer is $actual, expected $desired." >&2
    exit 1
}
if [ -f "$target" ]; then
    cp -a -- "$target" "$target.prev-$(date +%Y%m%d%H%M%S)"
fi
install -o root -g root -m 0755 -- "$staged" "$target"
command -v restorecon >/dev/null 2>&1 && restorecon -- "$target"
sha256sum -- "$target"
ROOT_SCRIPT

remote "mkdir -p ~/$STAGE_DIR"
scp -q -i "$SSH_KEY" -P "$SSH_PORT" "$ROOT/$INSTALLER" "$SSH_TARGET:$STAGED"
scp -q -i "$SSH_KEY" -P "$SSH_PORT" "$installer" "$SSH_TARGET:$STAGE_DIR/install.sh"
staged=$(remote "sha256sum $STAGED" | cut -d' ' -f1)
if [ "$staged" != "$desired" ]; then
    echo "refusing: staged copy hashes to $staged, expected $desired." >&2
    exit 1
fi
echo "staged on host  = $staged"

run_root="sudo sh ~/$STAGE_DIR/install.sh ~/$STAGED $desired $TARGET_PATH"
if [ "$apply" = false ]; then
    cat <<EOF

Not installed. To install (asks for the sudo password, since there is no
NOPASSWD rule for this path):

  ssh -t -i $SSH_KEY -p $SSH_PORT $SSH_TARGET '$run_root'

Then confirm and deploy:

  ssh -i $SSH_KEY -p $SSH_PORT $SSH_TARGET 'sha256sum $TARGET_PATH'

Or re-run this script with --apply.
EOF
    exit 0
fi

# -t so sudo can prompt; BatchMode would suppress the prompt.
ssh -t -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_TARGET" "$run_root"

# The staged copies are only a transport; leave nothing usable behind.
remote "rm -rf ~/$STAGE_DIR"
echo "staged copies removed from the host"
