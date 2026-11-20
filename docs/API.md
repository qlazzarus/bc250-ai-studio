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

## Prompt composition snapshot

`GET /system/capabilities` optionally exposes `request_limits.max_body_bytes` (the configured whole HTTP body limit). Older servers or settings objects without a known body limit may omit it; clients must not assume a deployment-specific limit. Missing limit metadata does not disable other capabilities. It advertises `prompt_composition.schema_versions: [1, 2]` when this optional request is supported. `POST /jobs` accepts `prompt_composition` as a bounded, versioned explanation of the applied draft: target family, compiler version, selected IDs/categories/labels/dictionary versions and captured mapping values, original Korean free text, draft and unresolved items. Version 2 adds `remainder`: at most 8 accepted out-of-dictionary translations, each with `source_ko` (≤ 200 chars), `suggested_en` (≤ 200 chars), `proposal_id` (8–64 chars), `proposal_model` (1–200 chars) and `accepted_at` (`YYYY-MM-DDTHH:MM:SSZ`, second precision). The submitted top-level `prompt` remains authoritative. Registry validation rejects a target family that differs from the chosen model. No composition field affects engine arguments.

The job spec, durable SSE events, per-asset metadata and JSON sidecar retain the snapshot; retry copies it without recompiling. Old job and asset reads return `null` when absent. Requests omitting the field remain valid. Composition metadata is visible to authenticated Studio clients under the existing shared access model and is stored in event and asset copies. Deploy the server first; clients must feature-detect and inform users if the composition cannot be saved. A client that can write v2 but sees `schema_versions: [1]` drops `remainder` and submits v1 while telling the user the translations were not recorded — the final prompt still contains them, because the prompt is what gets generated. See [P0 decisions](PROMPT_COMPOSER_P0.md).

Composition limits: at most 100 selections, 4,000 characters of free text, 8,000 characters of draft, 101 unresolved items (4,000 characters each), 300 characters per rendered selection, and — in v2 only — 8 `remainder` items. The normalized composition JSON is limited to 32 KiB of UTF-8; that single budget still binds, and `remainder` gets no separate byte cap. The separate HTTP body limit is configurable (`max_body_bytes`, source default 65,536 bytes) and can reject the entire request with 413 before schema validation. Extra fields, NUL characters, duplicate selection IDs and inconsistent mapping status/expression pairs are rejected. `remainder` is a v2 key, so a v1 body carrying it is rejected as an extra field; a client that knows the server advertises only `[1]` must send a v1 body with no translations rather than risk a 422. The server does not look up dictionary IDs or recompile the snapshot. Compiler warnings, source arrays, free-text application mode and application-time prompt fingerprints are not stored fields. P5 can explicitly include the unchanged free text in `draft_prompt`; `unresolved` still describes untranslated text and is not proof of omission from the final prompt. Clients show the saved draft/final string comparison and mark unrecorded provenance as unknown. See [current implementation](PROMPT_COMPOSER_CURRENT.md) for client state and restoration behavior.

## LLM prompt proposals

`GET /system/capabilities` optionally exposes `prompt_proposals` when this process can actually serve one: a loaded dictionary, a configured gate (`admission_url`) and a non-empty `llm_model`. The field carries `schema_versions: [1]`, `max_response_bytes: 16384`, `timeout_ms: 20000` and `dictionary_version`. When it is absent, clients must fall back to the local rule-based suggestions and must not show a disabled AI button: an older or unconfigured server looks unsupported, not broken. The dictionary itself is never sent to the browser; the server validates IDs against its own copy and the client only compares versions.

`POST /prompt/proposals` takes `kind` (`selection_hint`, `partial_change`, `situation_variants` or `remainder_translation`), `request_id`, `target_family`, `dictionary_version`, `free_text_ko` and `revisions` (`scene`, `selection`, `text`); unknown fields are rejected. It is one explicit attempt with no retry, no queue, no streaming and no stored history; proposal accept/reject stays client-side and `jobs.spec` is unchanged.

`remainder_translation` translates the Korean phrases a dictionary cannot express, and it is the only kind whose request carries `remainder_spans` instead of words. The request sends `[{start, end}]` code-point offsets into `free_text_ko` (at most 8 spans, each within the text and at least 2 characters), never the phrase text, so the 8 KiB request budget and the "no user text in a second place" rule both hold. The server slices `free_text_ko` itself to build the user message and refuses a span list on any other kind. The reply repeats the shape of every other kind but answers in `translations: [{source_ko, suggested_en, confidence}]`: at most 8 items, `source_ko`/`suggested_en` 1–200 characters, `source_ko` echoed from the server's own slice. `suggestions`, `variants` and the diff fields stay present-but-empty, and an unknown `kind` still answers `unsupported_v1`.

The shipped client (`frontend/src/prompt/llmProposals.ts`) sends `kind: "selection_hint"` only from an explicit button click, never while typing. It derives the three `revisions` as `sha256:<hex>` over the family, the verbatim free text and the ordered selection ID/category pairs, and it aborts at the advertised `timeout_ms` plus five seconds. A reply is applied only when its `request_id` matches the request in flight, its echoed `kind` matches the request that was sent, and the client state still matches the revisions that were sent; otherwise the reply is discarded and the free text, the selections and the final prompt stay untouched. When `prompt_proposals` is absent, or its `dictionary_version` differs from the client's, the client does not call the endpoint at all and keeps the rule-based suggestions.

For a partial change the same client sends `kind: "partial_change"` with `target_groups` (display groups the user picked) and `locked_ids` (every current selection outside those groups, derived by the client rather than typed). Both lists are optional on the wire and absent for `selection_hint`, so that request is unchanged. A lock is a *setting* lock: it keeps the chosen values, it does not guarantee that two generations show the same person, and the client says so wherever it explains the lock. The server rejects a reply that touches a locked ID (`why: "locked"`) or a group outside `target_groups` (`why: "out_of_scope"`); the client applies the same two rules to the reply it receives, so a stubbed or older answer cannot bypass them. Nothing is applied on arrival here either — the diff is displayed before any click, and a one-step undo removes only the IDs the acceptance added, refusing once the scene's fingerprint has moved on.

`situation_variants` (VAR01) is a third kind with its own reply field and its own rules. The request carries `target_groups` restricted to the two display groups a situation may change (`pose`, `setting` — the dictionary aliases `action`→`pose` and `location`→`setting`) and `locked_ids` for everything else, so the cast and the outfit cannot be rewritten. The reply carries `variants: [{variant_id, label_ko, prompt_ko, changed_ids, removed_ids, unresolved_ko, actor}]` — at most 3 Korean candidates, `label_ko` ≤ 40 chars, `prompt_ko` ≤ 200 chars, at most 20 IDs per list, `variant_id` matching `^[A-Za-z0-9_.-]+$`. A candidate is rejected whole (never half-applied) with `why` one of `attribution_unsupported_v1` (`actor` set; per-person attribution waits for SCENE01/02), `no_change` (empty diff), `duplicate`, `not_in_dictionary`, `inactive_entry`, `locked`, `already_selected` (a `changed_ids` entry that is already chosen), `not_selected` (a `removed_ids` entry the scene does not contain) or `out_of_scope` (any group other than place/action). An `actor` candidate also adds an `actor_unknown` ambiguity. The server sets `truncated` when more than 3 candidates survive. A `variants` array on any other kind is rejected with `why: "unexpected_kind"`, and `variants` is omitted entirely for the two older kinds, so their replies are byte-identical to what C01/I06 fixed.

Candidates are **never applied automatically**: arriving in a reply changes nothing, and nothing in a variant reply touches the free text, the compiled draft, the saved composition or `jobs.spec`. The shipped client renders them as cards (`frontend/src/prompt/situationVariants.ts`) with the place/action diff and the unresolved Korean phrases verbatim, and a card is offered one `적용` button only when it has no blocker (VAR02). Applying goes through `frontend/src/prompt/variantApply.ts`, which re-checks the blocker, rebuilds the selection with the ordinary `selectEntry`/`removeEntry` path (so a candidate cannot produce a scene the picker could not), and records the whole pre-apply scene for a one-step undo gated by the scene fingerprint. Candidates themselves are never persisted: the server stores nothing from a variant reply, and copying candidates into a saved composition is not a v1 feature.

When a reply is accepted, the shipped client (`frontend/src/prompt/proposalCards.ts`) turns it into accepted-or-not cards rather than applying it: `suggestions` become one card each, and `unresolved_spans`/`ambiguities`/`truncated`/`rejected` are what the cards display. A card is offered an accept button only when its `id` resolves to an active dictionary entry with no blocker (duplicate, not in dictionary, inactive, already selected, conflict, unmapped for the displayed family). `basis: "inferred"` stays individually acceptable but is excluded from batch acceptance; only unblocked `basis: "quote"` cards form the batch. Accepting uses the ordinary selection path, so the free text, the selections the user made, and the final prompt/prompt input are unchanged until the user applies a draft. Nothing in the reply is applied by merely arriving: every change needs a click, and `rejected`/`unresolved_spans` are diagnostics the client never turns into selections.

Failure answers are HTTP 200 with a body, because the UI degrades instead of showing an error. `status: "unsupported_v1"` means the `kind` is not part of v1 (`translation`, `attribute_split`). `status: "unavailable"` carries `why` from `not_configured`, `request_too_large`, `stale_dictionary`, `gpu_unavailable` (`detail` `recovery_required` / `image_running` / `manual_approval`), `admission_paused`, `gate_unreachable`, `upstream_status`, `timeout`, `cancelled`, `invalid_reply` or `busy`, plus a server-authored `message`. Negative answers keep the diagnostic `unresolved_spans`/`ambiguities`/`rejected` the validator established but never return suggestions. HTTP errors are reserved for transport facts: 401 without a Studio Bearer credential, 413 for a body over the 8 KiB proposal cap, 422 for JSON that is not the agreed schema. Concurrent requests are limited per credential (1) and globally (2); excess is `busy`, not queued. GPU/scheduler state is only read, never changed, and no gate or llama credential appears in the reply. Timeout is 20 s; a client abort is reported as `cancelled` and the late reply is discarded.

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
