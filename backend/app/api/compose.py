"""Authenticated compose endpoint (UCP03).

One credential boundary in front of the LLM, the same ``authenticate`` every Studio
route uses. The gate's data path has no authentication of its own, so a browser must
never reach it directly.

Two failure shapes, and the difference between them is the point:

* **HTTP errors** are facts about the *request*: 401 no credential, 409 a stale client
  view, 413 over the 24,576 B cap, 422 a malformed or inconsistent body. The client must
  not paper over these (§5).
* **`status: "unavailable"`** is a fact about the *world*: the GPU is busy, the gate is
  down, the model produced an unusable reply. The user's text and chips stay valid, so
  this is normally a 200 the UI degrades from — except when the provider cannot run at
  all, where §5 permits 503 alongside the body.
"""

import hashlib
import json
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from app.api.routes import authenticate, state
from app.models.schemas import ComposeRequest
from app.services.prompt_compose import (
    MAX_REQUEST_BYTES,
    ComposeInputError,
    ComposeProviderClient,
    compose_advertised,
    validate_request,
)
from app.services.prompt_dictionary import cached

router = APIRouter(prefix="/api/v1/prompt", dependencies=[Depends(authenticate)])

# §5 error codes, kept here so the browser never invents wording for a failure.
# `409` means "your view is stale, re-read then retry"; `422` means "the request itself
# is wrong"; `503` means "the feature cannot run in this deployment".
MESSAGES = {
    "stale_dictionary": "사전 버전이 서버와 다릅니다. 새로고침 후 다시 시도하세요",
    "stale_profile": "출력 프로필 버전이 서버와 다릅니다. 새로고침 후 다시 시도하세요",
    "stale_clarification": "장면이 바뀌어 이전 질문의 답을 적용할 수 없습니다",
    "model_family_mismatch": "선택한 모델과 계열이 일치하지 않습니다",
    "unknown_dictionary_id": "사전에 없는 항목이 포함되어 있습니다",
    "not_configured": "이 서버에서는 통합 생성을 사용할 수 없습니다",
    "request_too_large": "요청이 너무 큽니다",
}

# Provider-side failures. These leave the request valid, so they ride on the body; the
# message names the next action rather than the cause.
PROVIDER_MESSAGES = {
    "gpu_unavailable": "지금은 LLM을 사용할 수 없습니다",
    "admission_paused": "지금은 LLM이 일시정지되어 있습니다",
    "gate_unreachable": "LLM 게이트에 연결하지 못했습니다",
    "upstream_status": "LLM 응답 상태가 올바르지 않습니다",
    "timeout": "장면 생성 시간이 초과되었습니다",
    "cancelled": "요청이 취소되었습니다",
    "invalid_reply": "생성 형식이 올바르지 않아 적용하지 않았습니다",
    "busy": "이전 요청을 처리 중입니다",
}

DETAIL_MESSAGES = {
    "recovery_required": "GPU 복구 확인이 필요합니다",
    "image_running": "이미지 생성이 끝난 뒤 다시 시도하세요",
    "manual_approval": "관리자 승인 후 사용할 수 있습니다",
}


def credentials(token: str | None) -> str:
    """A stable per-credential unit for the session limit.

    ``authenticate`` proves which key was used, but the dependency does not return it.
    Hashing the token gives one bucket per credential without keeping the secret as a
    semaphore key.
    """
    return hashlib.sha256((token or "").encode()).hexdigest()[:32]


def compose_client(request: Request) -> ComposeProviderClient:
    """The process-wide provider, created once on first use.

    Building it per request would reset the concurrency semaphores and void the global
    limit; keeping it on ``app.state`` also lets tests inject a transport.
    """
    s = state(request)
    client = getattr(s, "compose_client", None)
    if client is None:
        client = ComposeProviderClient(s.settings)
        s.compose_client = client
    return client


def error_body(why: str, message: str, detail: str | None = None) -> dict:
    return {"status": "error", "why": why, "message": message,
            **({"detail": detail} if detail else {})}


def unavailable_body(outcome, message: str, detail: str | None = None) -> dict:
    """The `unavailable` reply: the full contract body plus why it is unavailable.

    A failure that never reached a validated request has no contract body to preserve, so
    it degrades to the bare error shape. What must never happen is a 500: the browser
    keeps its text and chips either way (§5).
    """
    if outcome.response is None:
        return error_body(outcome.failure or "invalid_reply", message, detail)
    body = outcome.response.model_dump(mode="json")
    body["status"] = "unavailable"
    # `why`/`message` are additions for the UI, not replacements: the contract fields
    # stay so the client can still match the reply to its request revision.
    body["why"] = outcome.failure
    body["message"] = message
    if detail:
        body["detail"] = detail
    return body


async def compose(request: Request,
                  authorization: Annotated[str | None, Header()] = None):
    s = state(request)
    # §5 step 1: capability before anything else, so a server that cannot run this at
    # all answers consistently instead of failing halfway through.
    dictionary = cached(s, s.settings)
    if not compose_advertised(s.settings, dictionary):
        return JSONResponse(
            error_body("not_configured", MESSAGES["not_configured"],
                       "capability_not_advertised"),
            status_code=503)

    raw = await request.body()
    if len(raw) > MAX_REQUEST_BYTES:
        # 413 is a transport fact, so the client must not retry blindly (§5).
        raise HTTPException(
            413, f"Compose request body exceeds {MAX_REQUEST_BYTES} bytes")
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(422, "Compose request is not valid JSON") from None
    if not isinstance(body, dict):
        raise HTTPException(422, "Compose request must be a JSON object")
    try:
        compose_request = ComposeRequest.model_validate(body)
    except ValueError as error:
        # The schema is the client's contract, so a malformed body is a 422 and never a
        # 200 failure the browser would show as a model problem.
        raise HTTPException(422, f"Invalid compose request: {error}") from None

    try:
        validated = validate_request(compose_request, registry=s.registry,
                                     dictionary=dictionary)
    except ComposeInputError as error:
        # 409/422/503: each names a different next action, so they are not merged.
        raise HTTPException(error.status_code,
                            f"{error.why}: {error.detail}") from None

    outcome = await compose_client(request).compose(
        validated,
        session=credentials(
            authorization.removeprefix("Bearer ") if authorization else None),
        # Read the live scheduler/GPU state; nothing here changes it (C02-3).
        mode=s.scheduler.mode,
        blocked=s.gpu.blocked,
        leased=s.gpu.leased,
        dictionary=dictionary.entries,
    )
    if outcome.failure is not None:
        message = MESSAGES.get(
            outcome.failure,
            DETAIL_MESSAGES.get(outcome.detail or "",
                                PROVIDER_MESSAGES.get(outcome.failure, "")))
        reply = unavailable_body(outcome, message, outcome.detail)
        # A provider that cannot run is a 503 (§5); an unusable reply is a 200 the UI
        # degrades from, because retrying the same input may still help.
        status = 503 if outcome.failure in {
            "not_configured", "gpu_unavailable", "admission_paused"} else 200
        return JSONResponse(reply, status_code=status)
    return outcome.response.model_dump(mode="json")


router.add_api_route("/compose", compose, methods=["POST"], status_code=200)

