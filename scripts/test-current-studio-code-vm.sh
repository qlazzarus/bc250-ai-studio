#!/usr/bin/env bash
# Reuse the protected staging procedure with Studio's editable source layout.
set -Eeuo pipefail
[[ $# == 1 && -f $1/scripts/test-current-code-vm.sh ]] || exit 1
exec bash "$1/scripts/test-current-code-vm.sh" "$1" studio
