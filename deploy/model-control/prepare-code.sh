#!/usr/bin/env bash
# Stage code only. This does not stop, start, install, or enable any service.
set -euo pipefail

[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
umask 022
[[ $# == 1 && -d "$1/backend/app" && -f "$1/pyproject.toml" && -f "$1/uv.lock" ]] || {
  echo 'Usage: prepare-code.sh TRUSTED_SOURCE_DIRECTORY' >&2; exit 1;
}
source_dir=$(realpath -e -- "$1")
target=/opt/bc250-model-control
[[ ! -e "$target" && ! -L "$target" ]] || {
  echo 'Target already exists; stop and follow the upgrade/rollback procedure.' >&2; exit 1;
}
if [[ -x /usr/bin/uv ]]; then uv=/usr/bin/uv
elif [[ -x /usr/local/bin/uv ]]; then uv=/usr/local/bin/uv
else echo 'Install a root-managed uv in /usr/bin or /usr/local/bin first.' >&2; exit 1
fi
[[ $(stat -Lc '%u %a' "$uv") == '0 755' ]] || {
  echo 'uv must be a root-owned 0755 executable.' >&2; exit 1;
}
[[ -z $(find "$source_dir/backend" -type l -print -quit) ]] || {
  echo 'The source backend must not contain symbolic links.' >&2; exit 1;
}
install -d -o root -g root -m 0755 "$target"
cp -RP --no-preserve=ownership -- "$source_dir/backend" "$target/backend"
install -o root -g root -m 0644 "$source_dir/pyproject.toml" "$source_dir/uv.lock" "$target/"
[[ -z $(find "$target/backend" -type l -print -quit) ]] || {
  echo 'A symbolic link appeared during the copy; staging failed.' >&2; exit 1;
}
chmod -R go-w "$target/backend"
cd "$target"
UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy "$uv" sync --locked --no-dev --no-editable --python /usr/bin/python3
chmod -R go-w "$target"
chmod -R a+rX "$target"
[[ -z $(find "$target" ! -uid 0 -print -quit) ]] || { echo 'Non-root owned file in target.' >&2; exit 1; }
[[ -z $(find "$target" ! -type l -perm /022 -print -quit) ]] || {
  echo 'Group/world-writable file in target.' >&2; exit 1;
}
"$target/.venv/bin/python" -I -c 'import sys; from pathlib import Path; import app.services.model_control_runtime as worker; import app.services.model_management_server as api; import app.gate as gate; root=Path(sys.prefix).resolve(); modules=(worker, api, gate); assert all(Path(m.__file__).resolve().is_relative_to(root) for m in modules), "Package is outside the protected virtual environment"; print("Model-control package imports OK")'
echo 'Root-owned model-control code staged; no service was changed.'
