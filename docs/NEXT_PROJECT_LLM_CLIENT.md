# Next project: authenticated RP/LLM client

This document is the handoff contract for the next project. It intentionally does
not add a browser-to-llama connection to the current Art Studio. The next project
owns an authenticated backend conversation gateway and associates finished image
assets with durable conversation messages.

## Verified BC-250 contract

The current LLM is controlled by `/usr/local/bin/ai-model`, whose public operations
are `list`, `status`, and `switch MODEL`. It is an operator model-switching tool,
not the LLM API. The active `llama-server.service` launches llama.cpp on loopback
`127.0.0.1:8080`, with Vulkan layers, a configured context/parallel-slot count,
automatic reasoning, and metrics enabled.

On 2026-10-24, the active model was a Qwen 3.5 35B-A3B Uncensored IQ2_M GGUF.
`GET /v1/models` reported a 4096-token context and a text output modality. Both
endpoints were exercised directly on loopback:

- `POST /v1/completions` returned a successful text completion.
- `POST /v1/chat/completions` returned HTTP 200 and an OpenAI-shaped
  `chat.completion` response.
- With `max_tokens: 8`, chat consumed the budget in `reasoning_content` and
  returned `finish_reason: "length"` with empty display `content`. This is a
  budget result, not an unavailable endpoint.

The integration must record the exact model ID returned in each completion rather
than treating the current absolute GGUF path as a stable public model name.

## Non-negotiable boundaries

1. A browser must call only the new project's authenticated backend. It must never
   call llama `8080`, the admission gate `8081`, or `/control` directly.
2. The backend calls llama through `http://127.0.0.1:8081`, never `8080`. The gate
   is admission control only; it is not end-user authentication.
3. Do not expose `GATE_API_KEY`, Studio credentials, or `ai-model switch` in any
   browser bundle, URL, browser storage, or client-side configuration.
4. `ai-model switch` remains an operator-only maintenance action. It can restart
   or replace the LLM while GPU/image transitions are sensitive.
5. The current gate buffers the complete upstream response before returning it.
   The first client version is non-streaming. Streaming needs a deliberate gate
   redesign that preserves active-request accounting across the full stream.
6. A Studio image job can stop llama to obtain GPU ownership. Finish the LLM request
   before creating an image job; never attempt to stop an active chat generation.

## First-release interaction contract

```text
Browser
  -> authenticated RP backend
  -> 8081 admission gate -> llama-server:8080
  -> persisted assistant message

Explicit image action on that message
  -> Studio POST /api/v1/jobs (source="rp", client_reference=<message id>)
  -> Studio durable job events
  -> persisted message-to-job / message-to-asset association
  -> browser image status card and completed asset
```

Use a clear UI action such as “이미지 생성” for the first release. Natural-language
intent extraction may be added after evaluating real transcripts and must produce
a confirmable structured image request; it must not silently spend GPU time.

## Minimum persistent data model

The next backend owns these records; the current Studio job/asset tables remain the
source of generation truth.

| Record | Required fields |
| --- | --- |
| conversation | id, owner/principal, created_at, updated_at, title |
| message | id, conversation_id, role, content, llm_model_id, finish_reason, created_at |
| message_image | message_id, studio_job_id, asset_id nullable, status, requested_prompt, created_at, completed_at |

`message_image.studio_job_id` must be unique. Submit the message ID as Studio
`client_reference` and retain the Studio `job_id` response before reporting a job
as accepted. This makes retries and terminal job reconciliation idempotent.

## API shape for the next backend

These are proposed project-owned routes, not routes implemented by this repository.

```text
POST /api/conversations
GET  /api/conversations/{conversation_id}/messages
POST /api/conversations/{conversation_id}/messages
POST /api/messages/{message_id}/image-jobs
GET  /api/messages/{message_id}/image-jobs/{job_id}
```

`POST /messages` accepts a non-streaming user message and returns a persisted
assistant message. Store `message.content` for display and `reasoning_content`
only as restricted diagnostic data, if stored at all. Do not return internal
reasoning to the default UI. Use a response budget of at least 256 tokens for
normal chat and treat `finish_reason: "length"` as incomplete.

`POST /image-jobs` creates a Studio job only after explicit user confirmation. It
uses `source: "rp"`, the selected validated Studio model ID, and the originating
message ID as `client_reference`. It does not call `ai-model switch`.

## Required pre-implementation checks

Before implementing the backend adapter, repeat these checks through **8081** while
no image job is active:

1. `GET /v1/models` through the gate.
2. A bounded non-streaming `/v1/chat/completions` request with at least 256 output
   tokens; record response shape, finish reason, and model ID.
3. A bounded `/v1/completions` request as compatibility fallback.
4. Confirm gate control is `paused=false`, `waiting_requests=0`, and
   `active_requests=0` after each request.
5. Submit one `source: "rp"` image job after the LLM response ends, then verify
   llama recovery and the asset/job link.

## Acceptance criteria

- No browser network request targets ports 8080 or 8081.
- A chat message remains durable across a backend restart.
- An image request is linked to exactly one Studio job and its final asset(s).
- A failed or interrupted Studio job is visible on the originating message and can
  be explicitly retried without duplicating the original relation.
- Images never start while the associated LLM request is active.
- `ai-model switch` is rejected or unavailable while a Studio GPU transition or
  image job is active.
- Operator logs contain IDs and timing, never prompt secrets or API keys by default.
