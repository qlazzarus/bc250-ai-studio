#!/usr/bin/env bash
# Read-only inventory of the BC-250 host. Changes nothing.
#
# Runs from the Mac over SSH and executes only read-only commands on the server:
# systemctl show/is-active, `ss -lntp`, `ls`, `find`, `vulkaninfo --summary`,
# reading /proc/<pid>/cmdline, and loopback GETs to llama / gate / Studio.
# It never calls sudo, never restarts or enables a service, never writes to the
# host, and does not enqueue a Studio job. Anything unreadable without root is
# reported as unreadable rather than escalated.
#
#   scripts/ucp09/inspect-bc250.sh                  # report to stdout
#   scripts/ucp09/inspect-bc250.sh > report.txt      # keep a copy
#
# Override the target with UCP09_SSH / UCP09_KEY / UCP09_PORT.
set -eu

SSH_TARGET=${UCP09_SSH:-yeppyshiba@yeppyshiba.iptime.org}
SSH_PORT=${UCP09_PORT:-2222}
SSH_KEY=${UCP09_KEY:-$HOME/.ssh/bc250_studio_maintenance}

ssh -i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes -o ConnectTimeout=10 \
    "$SSH_TARGET" 'bash -s' <<'REMOTE'
set -u
say() { printf '\n### %s\n' "$1"; }
sec() { printf '\n## %s\n' "$1"; }

say HOST
hostname
uname -r
cat /etc/fedora-release 2>/dev/null || echo 'fedora-release unreadable'
uptime
printf 'load     '; cat /proc/loadavg

sec SERVICES
# is-active/is-enabled only read unit state; nothing is started or stopped.
for unit in bc250-ai-studio.service bc250-llm-gate.service \
            bc250-model-worker.service bc250-model-worker.socket \
            llama-server.service caddy.service; do
    printf '%-32s active=%-10s enabled=%s\n' "$unit" \
        "$(systemctl is-active "$unit" 2>&1)" "$(systemctl is-enabled "$unit" 2>&1)"
done

sec LLAMA_SERVER
unit=llama-server.service
if systemctl is-active --quiet "$unit"; then
    pid=$(systemctl show "$unit" -p MainPID --value)
    printf 'main pid  = %s\n' "$pid"
    # The real invocation: model path, context and threads live in argv.
    if [ -r "/proc/$pid/cmdline" ]; then
        printf 'argv      = '
        tr '\0' ' ' < "/proc/$pid/cmdline" | sed 's/ --/\n            --/g'
        printf '\n'
    else
        echo 'argv      = unreadable without root (/proc is root-owned)'
    fi
    printf 'health    = '
    curl -sS --max-time 5 http://127.0.0.1:8080/health 2>&1 | head -c 200
    printf '\nprops     = '
    curl -sS --max-time 5 http://127.0.0.1:8080/props 2>&1 \
        | grep -oE '"n_ctx":[0-9]+|"n_slots":[0-9]+|"model_path":"[^"]*"' | tr '\n' ' '
    printf '\n'
else
    echo 'llama-server is not active; no model or context is loaded'
fi

sec LLM_GGUF
# Only weights, not the vocab-only test blobs under /opt/llama.cpp/models.
find /opt /home -maxdepth 5 -name '*.gguf' -size +500M \
    -printf '%12s  %p\n' 2>/dev/null | sort -k2 || echo 'no large gguf found'

sec IMAGE_ENGINE
if [ -x /opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli ]; then
    printf 'sd-cli    = '
    ls -l /opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli \
        | awk '{print $5" bytes, "$6" "$7" "$8}'
    sha256sum /opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli
else
    echo 'sd-cli    = missing'
fi
echo 'image weights:'
find /opt/sd-models -maxdepth 3 -type f \
    \( -name '*.gguf' -o -name '*.safetensors' -o -name '*.ckpt' \) \
    -printf '%12s  %p\n' 2>/dev/null | sort -k2 || echo '  /opt/sd-models unreadable'

sec GPU
printf 'drm vendor = '
cat /sys/class/drm/card*/device/vendor 2>/dev/null | sort -u | tr '\n' ' '
printf '\n'
vulkaninfo --summary 2>/dev/null \
    | grep -iE 'deviceName|driverName|driverInfo' | sed 's/^[[:space:]]*/  /'
lsmod 2>/dev/null | awk '$1 ~ /^amdgpu$|^radeon$/ {print "  " $0}'
printf 'amdgpu errors in dmesg: '
errs=$(dmesg 2>/dev/null | grep -i amdgpu | grep -iE 'error|fail' | tail -5 || true)
if [ -n "$errs" ]; then
    printf '\n  %s\n' "$errs"
else
    echo 'none found (or dmesg unreadable without root)'
fi

sec GPU_GATE
printf 'gate pid  = %s\n' \
    "$(systemctl show bc250-llm-gate.service -p MainPID --value 2>/dev/null)"
for p in /health /status /v1/status; do
    printf 'gate %-11s = ' "$p"
    curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
        "http://127.0.0.1:8081$p" 2>&1
    printf '\n'
done
echo 'gpu lock files:'
ls -l /run/bc250-gpu/ 2>/dev/null || echo '  /run/bc250-gpu unreadable'

sec PORTS
# Loopback-only listeners are the intended shape; only Caddy should be public.
ss -lntp 2>/dev/null | awk 'NR==1 || /:(80|443|8080|8081|8090|18080)[[:space:]]/'
echo 'caddy sites:'
grep -hE '^[^#[:space:]].*\{' /etc/caddy/Caddyfile 2>/dev/null | head -10 \
    || echo '  /etc/caddy/Caddyfile unreadable'

sec DATA_PATHS
ls -ld /opt/bc250-ai-studio /opt/ai-studio-data /var/lib/bc250-model-control 2>&1
echo 'studio config files:'
ls -1 /opt/bc250-ai-studio/config/ 2>&1
echo 'database + asset directories:'
ls -l /opt/ai-studio-data/database/ 2>&1 | head -5
ls -d /opt/ai-studio-data/*/ 2>&1 | head -8
echo 'newest release backups:'
ls -1dt /var/backups/bc250-ai-studio.* 2>/dev/null | head -3 || echo '  none listed'

sec COMPOSE_READINESS
# UCP09 needs `prompt_compose` advertised, which needs three things at once:
# a gate (admission_url), a non-fake engine, and a loaded prompt dictionary.
d=/opt/bc250-ai-studio/config/prompt_dictionary.json
if [ -f "$d" ]; then
    printf 'dictionary = present, '
    python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print("version",d.get("dictionary_version"),"entries",len(d.get("entries",[])))' "$d" 2>&1
else
    echo 'dictionary = MISSING -> prompt_proposals and prompt_compose cannot be advertised'
    # The mirror is committed (config/prompt_dictionary.json) and the deploy
    # tarball contains it; the installed release installer copies the config
    # directory, so a missing file means the release was deployed by an older
    # installer. Point at the copy list itself rather than at any mention of
    # models.yaml (the current installer names it in a comment too).
    if grep -q '^for item in .*config/models\.yaml' /usr/local/sbin/bc250-ai-studio-deploy 2>/dev/null; then
        echo '  cause: /usr/local/sbin/bc250-ai-studio-deploy copies only config/models.yaml'
        echo '  fix:   install the current installer (scripts/ucp09/install-deployer.sh)'
    fi
fi
echo 'unit environment file:'
grep -oE 'EnvironmentFile=[^ ]+' \
    /etc/systemd/system/bc250-ai-studio.service 2>/dev/null || echo '  none declared'

sec DISK
df -h / /opt 2>/dev/null | head -4
REMOTE
