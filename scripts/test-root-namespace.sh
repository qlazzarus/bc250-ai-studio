#!/usr/bin/env bash
# Local Linux test only: a private user/mount namespace and temporary tmpfs.
# Usage: scripts/test-root-namespace.sh /absolute/path/to/test-venv
set -euo pipefail

if [[ ${BC250_NAMESPACE_INNER:-} != 1 ]]; then
  [[ $# == 1 && -x "$1/bin/python" ]] || { echo 'Provide the test virtualenv path.' >&2; exit 1; }
  repo=$(cd "$(dirname "$0")/.." && pwd -P)
  venv=$(cd "$1" && pwd -P)
  stage=$(mktemp -d "${TMPDIR:-/tmp}/bc250-root-test.XXXXXXXX")
  trap 'rmdir "$stage"' EXIT
  BC250_NAMESPACE_INNER=1 BC250_NAMESPACE_REPO="$repo" BC250_NAMESPACE_VENV="$venv" \
    BC250_NAMESPACE_STAGE="$stage" unshare --user --map-root-user --mount --propagation private "$0"
  exit
fi

root=$BC250_NAMESPACE_STAGE
repo=$BC250_NAMESPACE_REPO
venv=$BC250_NAMESPACE_VENV
[[ -x /usr/bin/python3.12 && -d /usr/lib/python3.12 ]] || {
  echo 'This harness currently requires local Python 3.12.' >&2; exit 1;
}
mount -t tmpfs -o mode=0755,size=768m tmpfs "$root"
mkdir -p "$root/usr/bin" "$root/usr/lib" "$root/venv" "$root/workspace" "$root/fixture" "$root/tmp" "$root/dev" "$root/etc"
printf 'root:x:0:0:root:/root:/bin/bash\n' > "$root/etc/passwd"
printf 'root:x:0:\n' > "$root/etc/group"
chmod 1777 "$root/tmp"
touch "$root/dev/null"
cp /usr/bin/python3.12 "$root/usr/bin/python3.12"
ln -s python3.12 "$root/usr/bin/python3"
cp -R --no-preserve=ownership /usr/lib/python3.12 "$root/usr/lib/python3.12"
cp -R --no-preserve=ownership "$venv/." "$root/venv/"
cp -R --no-preserve=ownership "$repo/backend" "$root/workspace/backend"
cp -R --no-preserve=ownership "$repo/deploy" "$root/workspace/deploy"
cp "$repo/pyproject.toml" "$repo/uv.lock" "$root/workspace/"
if [[ -n ${BC250_NAMESPACE_UV_CACHE:-} ]]; then
  mkdir -p "$root/opt" "$root/uv-cache"
  cp -R --no-preserve=ownership "$BC250_NAMESPACE_UV_CACHE/." "$root/uv-cache/"
  cp "$venv/bin/uv" "$root/usr/bin/uv"
  for program in bash env id realpath stat find cp install chmod; do
    cp -L "/usr/bin/$program" "$root/usr/bin/$program"
  done
  ln -s usr/bin "$root/bin"
fi
{
  ldd /usr/bin/python3.12
  if [[ -n ${BC250_NAMESPACE_UV_CACHE:-} ]]; then
    for program in bash env id realpath stat find cp install chmod; do ldd "/usr/bin/$program"; done
    ldd "$venv/bin/uv"
  fi
  find /usr/lib/python3.12 "$venv" -type f -name '*.so' -exec ldd '{}' \; 2>/dev/null
} | awk '$2 == "=>" && $3 ~ /^\// {print $3} $1 ~ /^\// {print $1}' | sort -u > "$root/libraries"
while IFS= read -r library; do cp -L --parents "$library" "$root"; done < "$root/libraries"
PYTHONPATH=/workspace/backend BC250_ROOT_NAMESPACE_TEST=1 BC250_TEST_UV_CACHE="${BC250_NAMESPACE_UV_CACHE:+1}" \
  chroot "$root" \
  /venv/bin/python -m pytest -s -q -p no:cacheprovider /workspace/backend/tests/test_root_namespace.py
