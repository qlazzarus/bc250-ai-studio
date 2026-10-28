# Architecture / Phase 0 decision record

2026-10-24. This repository starts from an empty macOS development directory, not the
Fedora BC-250 host. Python 3.13.3 and uv are present; approximately 40 GiB is free.
No /opt/stable-diffusion.cpp, /opt/sd-models or vulkaninfo was found locally.
Port 8000 is already used locally; the Studio default is loopback 8090.
No remote host credentials were supplied. All target hardware/service claims remain
unverified. Existing installations, models and services must not be modified.

## Boundaries

React/Vite clients (Phase 2/3) and RP clients (Phase 4) use the same authenticated
FastAPI API. SQLAlchemy/SQLite stores immutable submitted settings, state, assets,
per-image results and durable ordered events. One scheduler owns a filesystem
instance lock and one GPU manager serializes transitions. Never deploy multiple
Uvicorn workers. A separate host GPU lock serializes cooperating Studio instances;
unrelated programs must also be prevented from using the GPU operationally.

Adapters isolate sd-cli, service control and background removal. Real sd-cli runs
with an argument list, a timeout, a private output directory and process-group
cleanup. Model definitions are trusted operator YAML, never request-supplied paths.
All generated data lives outside this checkout. No uploads or shell command APIs.

The default engine is visibly simulated, not a claim of GPU compatibility. Real
execution requires operator configuration, an allowlisted verified systemd unit,
explicit GPU-test approval, and a verified admission gate for ALL LLM callers.
A slots snapshot alone cannot prevent a new request racing with systemd stop.
The local admission gate must pause new requests before slots drain; its protocol
is documented in LLM_GATE.md. Phase 4 supplies an authenticated backend conversation
gateway and RP message/image association; a browser never accesses llama or the gate
directly. Unknown admission/slots state fails closed. A busy timeout never kills
active chat.

A durable transition journal is written before any real service mutation. Unclean
restart with this journal blocks GPU work pending operator inspection and explicit
recovery. No automatic LLM restart over a potentially surviving GPU child.
Transient job states become interrupted at restart. Completed files and DB assets
are retained; partial batch successes are retained. Recovery errors persist in DB.
Worker completion and LLM recovery success are separate: outputs may exist even
when the job is failed because LLM recovery failed.

## Policy boundary

manual requires an admin one-job grant; policy updates do not kill an active image.
chat_priority restores chat after each image job and yields a batch at an image
boundary when the admission gate reports pending chat. image_priority keeps the
lease across queued jobs until the queue empties or policy changes. CPU processing
will share the queue but not require a GPU lease (Phase 3).

## Scope

Phase 1 delivers generation/batches, models, authenticated assets, durable SSE,
policies, adapters, recovery and tests. A standalone LLM admission gate is included;
RP message/image association remains Phase 4. Pixel routes/types are reserved
contracts, not pretend implementations. No image generation model downloads.

The verified BC-250 llama API supports both non-streaming completions and chat
completions. The current gate buffers upstream responses, so Phase 4 begins
non-streaming. Chat completions can emit separate reasoning content; store it as
restricted diagnostics at most, not as default user-visible text. The detailed
handoff is [NEXT_PROJECT_LLM_CLIENT.md](NEXT_PROJECT_LLM_CLIENT.md).
