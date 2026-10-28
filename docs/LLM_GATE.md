# LLM admission gate and real API engine

The gate is a separate, local proxy. It preserves the existing llama-server service
and its port 8080. RP clients use port 8081 instead:

```text
RP client -> 8081 gate -> 127.0.0.1:8080 llama-server
Studio -> 127.0.0.1:8081/control -> pause/drain/stop -> sd-cli -> start/resume
```

When paused, the gate holds new requests before forwarding them. Existing requests
remain active and Studio polls llama `/slots`; only after all slots report
`is_processing: false` does it stop llama. Gate control has a separate secret.
The control endpoint binds to the same gate listener, but requires `GATE_API_KEY`.
It must never be exposed to untrusted users. LLM API credentials are simply passed
through to llama; the gate is admission control, not a replacement for LLM auth.

The current proxy buffers the entire upstream response before it returns a response.
It safely accounts for a request until completion, but it does not provide token
streaming to browser clients. A future authenticated RP backend calls the gate on
loopback; browsers must not call either 8080 or 8081 directly. See
[NEXT_PROJECT_LLM_CLIENT.md](NEXT_PROJECT_LLM_CLIENT.md).

## BC-250 deployment

All existing LLM callers must move from `http://127.0.0.1:8080` to the gate.
Both llama 8080 and the gate 8081 bind to loopback by default. For a first safe
test, use an SSH tunnel for 8081 in the same way as Studio 8090. A later reverse
proxy may publish only the required LLM routes after authenticating clients and
must deny `/control`; do not publish 8080 or expose the gate control route.

Create a distinct control key. The following is a server-side operation and does
not alter llama-server:

```bash
cd /opt/bc250-ai-studio
sudo python3 - <<'PY'
import os
import secrets

path = '/etc/bc250-llm-gate.env'
key = secrets.token_urlsafe(32)
body = f'GATE_API_KEY={key}\nGATE_UPSTREAM_URL=http://127.0.0.1:8080\nGATE_PROXY_TIMEOUT=900\n'
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as file:
    file.write(body)
PY
sudo install -m 0644 systemd/bc250-llm-gate.service /etc/systemd/system/bc250-llm-gate.service
sudo systemctl daemon-reload
sudo systemctl enable --now bc250-llm-gate.service
sudo systemctl status bc250-llm-gate.service --no-pager
```

Do not print or put `GATE_API_KEY` in chat, shell history, URLs, or client code.
Read it only in a root-controlled setup step to copy it into the Studio environment:

```bash
sudoedit /etc/bc250-ai-studio.env
```

Add the following, replacing the placeholder with the same GATE_API_KEY stored in
`/etc/bc250-llm-gate.env`. Do not change `STUDIO_ENGINE` yet.

```ini
STUDIO_LLM_SERVICE=llama-server.service
STUDIO_ALLOWED_SERVICES=["llama-server.service"]
STUDIO_LLM_URL=http://127.0.0.1:8080
STUDIO_ADMISSION_URL=http://127.0.0.1:8081/control
STUDIO_ADMISSION_KEY=GATE_CONTROL_KEY
```

Before enabling the real engine, verify: start llama through its established
operator procedure, call a non-generation endpoint through 8081, and check that
the gate control reports zero active/waiting requests. The gate service does not
provide LLM service start/stop permission; Studio will need a narrowly scoped
polkit rule allowing only `llama-server.service` start and stop:

```javascript
polkit.addRule(function(action, subject) {
    if (action.id === "org.freedesktop.systemd1.manage-units" &&
        subject.user === "ai-studio" &&
        action.lookup("unit") === "llama-server.service" &&
        (action.lookup("verb") === "start" || action.lookup("verb") === "stop")) {
        return polkit.Result.YES;
    }
});
```

`unit` and `verb` are details supplied by systemd for normal StartUnit/StopUnit
requests. The rule does not allow daemon reload, unit-file changes, arbitrary
services, restart, or privileged shell commands. Polkit monitors its rule directory
and reloads changed rules automatically.

## Verified LLM endpoint behavior

The active BC-250 llama.cpp service was checked on 2026-10-24. Both
`/v1/completions` and `/v1/chat/completions` returned successful OpenAI-shaped
responses on loopback. The active Qwen model runs with reasoning mode `auto`; a
chat request limited to eight output tokens exhausted its budget in
`reasoning_content` and ended with `finish_reason: length`. Integration callers
must use a sufficient bounded output budget and treat incomplete finish reasons as
incomplete responses. The result model ID is an absolute GGUF path and must be
recorded, not exposed as a stable browser-facing alias.

## Verified Klein configuration

The recorded real test used `klein-4b-q4`, 512×512, 4 Euler steps, CFG 1.0 and
Vulkan0, without `--offload-to-cpu`. The model registry records `--backend Vulkan0`
and marks only this entry `tested`. CPU offload caused the observed RADV memory
submission failure and is not configured. This does not certify other models or
768×768 Klein.
