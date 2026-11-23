#!/usr/bin/env bash
# Print the Studio client key that the served bundle already contains.
#
# The key is public by design: VITE_STUDIO_API_KEY is inlined into the JS bundle
# the browser downloads (docs/DEPLOYMENT.md). This helper exists so ad-hoc checks
# use the same extraction as scripts/ucp09/verify-tunnel.sh instead of a
# hand-written regex per command. It never prints anything else.
#
#   scripts/ucp09/client-key.sh                     # key on stdout
#   KEY=$(scripts/ucp09/client-key.sh)              # use in a command
#
# Override the endpoint with UCP09_BASE_URL.
set -eu

BASE=${UCP09_BASE_URL:-http://127.0.0.1:18080}

index=$(curl -sS --max-time 10 "$BASE/")
bundle=$(printf '%s' "$index" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
[ -n "$bundle" ] || { echo 'no bundle in index.html' >&2; exit 1; }
js=$(curl -sS --max-time 30 "$BASE$bundle")

# Minified output keeps the key as a bare literal: the client is constructed as
# `new X(`/api/v1`,var)` and `var` is assigned `KEY`. Find the variable name from
# the constructor, then read its value, so no guessed name is needed.
var=$(printf '%s' "$js" | grep -oE '`/api/v1`,[A-Za-z_$][A-Za-z0-9_$]*' \
    | head -1 | sed 's/.*,//')
if [ -n "$var" ]; then
    key=$(printf '%s' "$js" | grep -oE "${var}=\`[A-Za-z0-9_-]{20,}\`" \
        | head -1 | sed 's/.*=`//; s/`$//')
    [ -n "$key" ] && { printf '%s\n' "$key"; exit 0; }
fi
echo 'client key not found in bundle' >&2
exit 1
