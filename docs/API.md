# API contract v1

All routes below use /api/v1 and Authorization: Bearer <API key>. Admin key is a
separate credential. Keys come from environment, never URL query parameters.
OpenAPI/docs require authentication too. No unauthenticated file/static mounts.
The Phase 1 trust model is a single-user studio with client and admin credentials;
client credentials share job/asset visibility (not multi-tenant isolation).

## Phase 1 implemented contract

- GET /system/status: scheduler, persisted error, recovery state, GPU owner.
- GET /system/health: API/DB liveness; does not require LLM to be running.
- GET /system/capabilities: explicit engine simulation and phase support.
- GET /system/policies; PUT /system/policies (admin): mode only, safe boundaries.
- POST /system/manual-grant (admin): permit one queued job in manual mode.
- POST /system/recover (admin): attempt journal recovery only after externally
  confirming no image worker survives; does not restart an active job.
- GET /models; GET /models/{id}; GET /models/{id}/presets.
- POST /jobs: 202 {job_id,status}; image.generate/image.batch only in Phase 1.
- GET /jobs?limit=50&offset=0; GET /jobs/{id}.
- POST /jobs/{id}/cancel: queued jobs cancel immediately; running jobs cancel at
  next image boundary, preserving completed batch outputs.
- POST /jobs/{id}/retry: 202 NEW job with identical resolved settings and seeds;
  terminal failed/interrupted/cancelled jobs only. Original remains auditable.
- GET /jobs/{id}/events: durable SSE `id`, `event: job`, JSON `data`. Replay from
  Last-Event-ID header or after query (non-negative integer). Heartbeat every 15s.
  A reconnect after terminal event yields an end comment and closes. No pruning
  in Phase 1, so event IDs remain replayable. Browser clients use fetch streaming
  to send Authorization (native EventSource cannot set this header).
- GET /assets?namespace=rp|nsfw|pixel&archived=false|true&limit=50&offset=0.
- GET /assets/{id}; GET /assets/{id}/metadata; GET /assets/{id}/file.
- POST /assets/{id}/archive; POST /assets/{id}/restore.
- DELETE /assets/{id}: archived assets only. The PNG and sidecar metadata move to
  the private Studio `trash/` directory before the DB record is removed; there is
  no automatic purge or API restore after this operation.

Job input: job_type, source (rp/nsfw/pixel), model_id, prompt, negative_prompt,
width, height, steps, cfg_scale, sampling_method, scheduler, seed (-1 resolves
once), priority (0..100), batch_count (1..16), preset, client_reference.
Parameters omitted from a request are resolved from model defaults/preset before
persistence; explicit unsupported parameters are rejected. project_id is reserved
and rejected until Phase 3.
Dimensions must match the model registry. A batch has stable per-image seeds and
per-image pending/running/completed/failed/cancelled/interrupted outcomes.

States: queued -> waiting_for_gpu -> running -> completed/failed/cancelled.
On crash: waiting_for_gpu/running -> interrupted. Retry does not mutate history.
Structured errors: 401 missing/invalid token, 403 admin needed, 404 absent,
409 state conflict, 422 validation/unsupported/unavailable model, 503 recovery block.
Prompt lengths, batch sizes, dimensions, concurrency and HTTP body size are bounded.

## Model generation options

`GET /models` and `GET /models/{model_id}` preserve the existing model object and
add `generation_options`. It describes `cfg_scale`, `negative_prompt`,
`sampling_method`, and `scheduler` with a mode (`fixed`, `experimental`,
`verified`, or `unsupported`), default, allowed values or numeric bounds, optional
condition, and note. Clients must treat a missing object as an older server and
must not invent a CLI option.

`sampling_method` accepts only the installed `sd-cli` enum:
`euler`, `euler_a`, `heun`, `dpm2`, `dpm++2s_a`, `dpm++2m`, `dpm++2mv2`, `ipndm`,
`ipndm_v`, `lcm`, `ddim_trailing`, `tcd`, `res_multistep`, `res_2s`, `er_sde`,
`euler_cfg_pp`, `euler_a_cfg_pp`, `euler_ge`, `dpm++2m_sde`, `dpm++2m_sde_bt`,
or `lms`. `scheduler` accepts `discrete`, `karras`, `exponential`, `ays`, `gits`,
`sgm_uniform`, `simple`, `smoothstep`, `kl_optimal`, `lcm`, `bong_tangent`,
`ltx2`, `logit_normal`, `flux2`, `flux`, `beta`, or `llada_image`. The `normal`
alias is deliberately rejected. A model with a fixed option accepts only its
declared default; no current model exposes a user-changeable sampler or scheduler.

PornMaster Klein 9B accepts experimental CFG `1.0`, `1.5`, and `2.0`. A non-empty
`negative_prompt` requires CFG `2.0`; other CFG values or combinations return 422
before queueing. This is an API/argv contract, not BC-250 quality or stability
validation.

Resolved `cfg_scale`, `negative_prompt`, `sampling_method`, and `scheduler` are
stored with the job spec and frozen model snapshot. Retry deep-copies that spec
instead of resolving against current model configuration. Asset metadata includes
the same fields. Metadata and job records predating these fields read them as
`null`; retry retains their legacy snapshot and `cli_args` semantics.

## Phase 3 implemented foundation

- GET/POST `/projects`; GET/PUT `/projects/{project_id}`.
- GET/POST `/projects/{project_id}/assets`: a Pixel Asset links to an existing
  active Studio source asset and has a semantic kind/name.
- POST `/assets/{pixel_asset_id}/process`: synchronous CPU Pillow processing into
  a derived transparent PNG version. This does not claim ML background removal.
- POST `/assets/{pixel_asset_id}/approve?version_id=...`.
- GET `/pixel/versions/{version_id}/file`.
- POST `/pixel/assets/{pixel_asset_id}/archive`; POST
  `/pixel/assets/{pixel_asset_id}/restore`; DELETE
  `/pixel/assets/{pixel_asset_id}` for archived Pixel Assets only.

Project-prompt candidate generation, `pixel.process` queue jobs, Atlas/manifest
export are follow-up Phase 3 work. Original Studio assets
and derived Pixel versions remain separate. Stable Pixel Asset IDs will name future
Atlas frames. See [PIXEL_STUDIO.md](PIXEL_STUDIO.md).

Phase 2 adds a recoverable archive UI. Permanent deletion is only available from
the archive view and requires an explicit browser confirmation.

## Reserved Phase 4 conversation contract

The current Studio does not expose chat routes. The next project's authenticated
backend owns conversations and invokes llama through the loopback admission gate;
it then submits explicit image requests to this API with `source: "rp"` and a
message ID in `client_reference`. Proposed conversation routes and persistence
requirements are documented in [NEXT_PROJECT_LLM_CLIENT.md](NEXT_PROJECT_LLM_CLIENT.md).
