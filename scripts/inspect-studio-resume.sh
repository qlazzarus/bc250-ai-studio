#!/usr/bin/env bash
# Run on BC-250. Read-only; never prints environment contents or credentials.
set -euo pipefail
for unit in bc250-ai-studio.service bc250-llm-gate.service \
    bc250-model-worker.service bc250-model-api.service; do
    systemctl show "$unit" -p Id -p LoadState -p ActiveState -p User \
        -p FragmentPath -p DropInPaths -p WorkingDirectory
done
for path in /opt/bc250-model-control /etc/bc250-model-control \
    /var/lib/bc250-model-control /var/lib/bc250-llm-gate /run/bc250-gpu; do
    if [[ -e "$path" || -L "$path" ]]; then
        printf 'PRESENT %s\n' "$path"
    else
        printf 'ABSENT %s\n' "$path"
    fi
done
for path in /usr/local/sbin/bc250-ai-studio-deploy \
    /opt/bc250-ai-studio/pyproject.toml /opt/bc250-ai-studio/uv.lock \
    /opt/bc250-ai-studio/backend/app/gate.py \
    /opt/bc250-ai-studio/backend/app/core/config.py \
    /opt/bc250-ai-studio/backend/app/core/files.py; do
    if [[ -f "$path" && -r "$path" ]]; then
        sha256sum "$path"
    else
        printf 'UNREADABLE_OR_ABSENT %s\n' "$path"
    fi
done
printf 'Read-only inspection complete; no service or configuration was changed.\n'
