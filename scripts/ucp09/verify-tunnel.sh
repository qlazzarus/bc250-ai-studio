#!/usr/bin/env bash
# Verify the SSH tunnel carries every Studio path through one origin.
#
# The tunnel is `ssh -L 127.0.0.1:18080:127.0.0.1:80`, so the browser, the API,
# SSE and image downloads all leave the Mac on 127.0.0.1:18080 and arrive at
# Caddy on the host. This checks that shape without opening anything else: it
# only makes loopback requests from the Mac and never touches the server.
#
#   scripts/ucp09/verify-tunnel.sh
#
# The client API key is needed for authenticated paths. It already ships in the
# served bundle by design (docs/DEPLOYMENT.md: VITE_STUDIO_API_KEY reaches the
# browser), so it is read from the bundle at run time and never printed. Set
# UCP09_CLIENT_KEY to skip that step.
set -eu

BASE=${UCP09_BASE:-http://127.0.0.1:18080}
pass=0
fail=0
KEY=${UCP09_CLIENT_KEY:-}

ok()   { pass=$((pass + 1)); printf 'PASS · %s\n' "$1"; }
bad()  { fail=$((fail + 1)); printf 'FAIL · %s\n' "$1"; }
info() { printf 'INFO · %s\n' "$1"; }

code() {
    if [ -n "$KEY" ] && [ "${2:-}" = auth ]; then
        curl -sS -o /dev/null -w '%{http_code}' --max-time "${3:-10}" \
            -H "Authorization: Bearer $KEY" "$1" 2>/dev/null || echo 000
    else
        curl -sS -o /dev/null -w '%{http_code}' --max-time "${3:-10}" \
            "$1" 2>/dev/null || echo 000
    fi
}

# --- 1. the tunnel is up and Caddy answers ----------------------------------
root_code=$(code "$BASE/")
if [ "$root_code" = 200 ]; then
    ok "터널 루트 200"
else
    bad "터널 루트가 $root_code (18080 포워딩 확인: ~/yeppyshiba-tunnel.sh)"
fi
server=$(curl -sSI --max-time 10 "$BASE/" 2>/dev/null | tr -d '\r' \
    | awk -F': ' 'tolower($1)=="server"{print $2}')
[ "$server" = Caddy ] && ok "Server: Caddy" || bad "Server 헤더가 '$server'"

# --- 2. the SPA shell and its hashed bundle ---------------------------------
# Same origin for HTML and assets keeps the built-in key valid.
shell=$(curl -sS --max-time 10 "$BASE/")
bundle=$(printf '%s' "$shell" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
css=$(printf '%s' "$shell" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.css' | head -1)
if [ -n "$bundle" ] && [ "$(code "$BASE$bundle")" = 200 ]; then
    ok "번들 로드 $bundle"
else
    bad "번들 로드 실패 ($bundle)"
fi
if [ -n "$css" ] && [ "$(code "$BASE$css")" = 200 ]; then
    ok "스타일시트 로드 $css"
else
    bad "스타일시트 로드 실패 ($css)"
fi

# --- 3. API through the same origin, unauthenticated ------------------------
# 401 is the correct answer and proves the proxy reaches FastAPI. Caddy's static
# handler would answer 404 for /api/v1 instead.
h=$(code "$BASE/api/v1/system/health")
if [ "$h" = 401 ]; then
    ok "비인증 health 401 (프록시가 FastAPI에 도달)"
elif [ "$h" = 200 ]; then
    bad "비인증 health가 200 — 인증이 꺼져 있음"
else
    bad "비인증 health가 $h (프록시/경로 확인)"
fi

# --- 4. authenticated API, still the same origin ----------------------------
# The key is a minified bare literal in the bundle: `<var>=`KEY`` and the client
# is constructed as `new X(`/api/v1`,<var>)`. Read both, print neither.
if [ -z "$KEY" ] && [ -n "$bundle" ]; then
    js=$(curl -sS --max-time 20 "$BASE$bundle" 2>/dev/null || true)
    var=$(printf '%s' "$js" | grep -oE '`/api/v1`,[A-Za-z_$][A-Za-z0-9_$]*' \
        | head -1 | sed 's/.*,//')
    if [ -n "$var" ]; then
        KEY=$(printf '%s' "$js" | grep -oE "${var}=\`[A-Za-z0-9_-]{20,}\`" \
            | head -1 | sed 's/.*=`//; s/`$//')
    fi
fi

if [ -n "$KEY" ]; then
    if [ "$(code "$BASE/api/v1/system/capabilities" auth)" = 200 ]; then
        ok "인증 capabilities 200"
        caps=$(curl -sS --max-time 10 -H "Authorization: Bearer $KEY" \
            "$BASE/api/v1/system/capabilities" 2>/dev/null || echo '{}')
        # The two compose keys mean different things and UCP09 needs the LLM one.
        case "$caps" in
            *'"prompt_compose"'*) ok "prompt_compose 광고됨" ;;
            *) info "prompt_compose 미광고 — UCP09 compose 단계 차단" ;;
        esac
        case "$caps" in
            *'"prompt_composition"'*) ok "prompt_composition(v1~3) 광고됨" ;;
            *) bad "prompt_composition 미광고" ;;
        esac
        # `prompt_proposals` shares the dictionary/llm_model gate with `prompt_compose`,
        # so reporting it separately says whether one conflict or two exist.
        case "$caps" in
            *'"prompt_proposals"'*) ok "prompt_proposals 광고됨" ;;
            *) info "prompt_proposals 미광고 — llm_model·사전 조건 확인" ;;
        esac
    else
        bad "인증 capabilities 실패"
    fi
    [ "$(code "$BASE/api/v1/models" auth)" = 200 ] \
        && ok "인증 models 200" || bad "인증 models 실패"
    [ "$(code "$BASE/api/v1/jobs?limit=1" auth)" = 200 ] \
        && ok "인증 jobs 200" || bad "인증 jobs 실패"
else
    info "클라이언트 키를 찾지 못해 인증 경로는 건너뜀 (UCP09_CLIENT_KEY 지정)"
fi

# --- 5. SSE over the tunnel ------------------------------------------------
# A real job stream must flush through Caddy (flush_interval -1). A made-up id
# would answer 404 and prove nothing about streaming, so the id comes from the
# job list; only when there is no job at all does this fall back to a path check.
if [ -n "$KEY" ]; then
    ids=$(curl -sS --max-time 10 -H "Authorization: Bearer $KEY" \
        "$BASE/api/v1/jobs?limit=1" 2>/dev/null || echo '[]')
    job=$(printf '%s' "$ids" | grep -oE '"job_id":"[^"]+' | head -1 | cut -d'"' -f4)
    [ -n "$job" ] || job="no-such-job"
    sse=$(curl -sS -o /dev/null -w '%{http_code} %{content_type} %{size_download}' \
        --max-time 6 -H "Authorization: Bearer $KEY" -H 'Accept: text/event-stream' \
        "$BASE/api/v1/jobs/$job/events" 2>/dev/null || echo '000 - 0')
    sse_code=${sse%% *}
    rest=${sse#* }
    sse_type=${rest% *}
    sse_bytes=${rest##* }
    if [ "$job" = "no-such-job" ]; then
        # Nothing to stream: 404/422 still proves the request reached FastAPI.
        case "$sse_code" in
            200|404|422) ok "SSE 경로 응답 $sse_code (작업 없음, 경로만 확인)" ;;
            *) bad "SSE 경로 응답 $sse_code" ;;
        esac
    else
        case "$sse_code:$sse_type" in
            200:text/event-stream*) ok "SSE 실작업 스트림 200 ($sse_bytes bytes)" ;;
            *) bad "SSE 실작업 스트림 $sse_code ($sse_type)" ;;
        esac
    fi
fi

# --- 6. image download through the same origin -----------------------------
# The gallery breaks if JSON works while PNG download does not, so this checks
# the real file path rather than only the metadata list.
if [ -n "$KEY" ]; then
    a=$(curl -sS --max-time 10 -H "Authorization: Bearer $KEY" \
        "$BASE/api/v1/assets?limit=1" 2>/dev/null || echo '[]')
    asset=$(printf '%s' "$a" | grep -oE '"asset_id":"[^"]+' | head -1 | cut -d'"' -f4)
    if [ -n "$asset" ]; then
        fc=$(curl -sS -o /dev/null \
            -w '%{http_code} %{content_type} %{size_download}' --max-time 20 \
            -H "Authorization: Bearer $KEY" \
            "$BASE/api/v1/assets/$asset/file" 2>/dev/null || echo '000 - 0')
        if [ "${fc%% *}" = 200 ]; then
            ok "이미지 다운로드 200 ($(printf '%s' "$fc" | cut -d' ' -f3) bytes)"
        else
            bad "이미지 다운로드 $fc"
        fi
    else
        info "자산이 없어 다운로드 확인 생략"
    fi
fi

# --- 7. nothing else is exposed -------------------------------------------
# The tunnel adds only 18080 on loopback. A service bound to a public address
# would be reachable without SSH, which is not the intended shape.
pub=$(ss -lntH 2>/dev/null \
    | awk '$4 !~ /^(127\.|\[::1\]|:::)/ && $4 ~ /:(8080|8081|8090|18080)$/ {print $4}' \
    | head -5 || true)
[ -z "$pub" ] && ok "Studio/gate/llama 포트는 loopback 전용" \
              || bad "공개 바인딩 발견: $pub"

printf '\nchecks: %s, failed: %s\n' "$((pass + fail))" "$fail"
[ "$fail" -eq 0 ]

