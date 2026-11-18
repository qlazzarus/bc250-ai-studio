"""Authenticated proposal endpoint (LLM-I03).

C02-1 puts exactly one credential boundary in front of the LLM: this router, using
the same ``authenticate`` as every other Studio route. The gate's data path has no
authentication of its own, so a browser must never reach it directly.

Two failure shapes, both HTTP 200 (C02-4), because the UI degrades instead of
showing an error:

* ``status: "unsupported_v1"`` - the route exists but this ``kind`` is not v1.
* ``status: "unavailable"``    - GPU/gate/provider could not produce a proposal.

HTTP errors stay reserved for *transport* facts the client must not paper over:
401 (no credential), 413 (body over the 8 KiB proposal cap), 422 (the request is
not the agreed schema).
"""

import hashlib
import json
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from app.api.routes import authenticate, state
from app.services.prompt_dictionary import ProposalDictionary, cached
from app.services.prompt_proposals import (
    MAX_RESPONSE_BYTES,
    VARIANT_KIND,
    ProposalRequest,
    ValidatedProposal,
)
from app.services.proposal_provider import (
    MAX_REQUEST_BYTES,
    Failure,
    ProposalProviderClient,
    proposals_advertised,
)

# C01-2 lists v1 kinds; VAR01 adds the third one. Anything else is unsupported_v1.
SUPPORTED_KINDS = frozenset({"selection_hint", "partial_change", VARIANT_KIND})

router = APIRouter(prefix="/api/v1/prompt", dependencies=[Depends(authenticate)])

# C02-3 UI wording, kept here so the browser never invents a sentence.
FAILURE_MESSAGES = {
    "not_configured": "이 서버에서는 LLM 제안을 사용할 수 없습니다",
    "stale_dictionary": "사전 버전이 서버와 다릅니다. 새로고침 후 다시 시도하세요",
    "request_too_large": "제안 요청이 너무 큽니다",
    "gpu_unavailable": "지금은 LLM을 사용할 수 없습니다",
    "admission_paused": "지금은 LLM이 일시정지되어 있습니다",
    "gate_unreachable": "LLM 게이트에 연결하지 못했습니다",
    "upstream_status": "LLM 응답 상태가 올바르지 않습니다",
    "timeout": "제안 생성 시간이 초과되었습니다",
    "cancelled": "제안 요청이 취소되었습니다",
    "invalid_reply": "제안 형식이 올바르지 않아 적용하지 않았습니다",
    "busy": "이전 제안 요청을 처리 중입니다",
}

# C02-3 gives each GPU state its own instruction, so the detail decides the text.
DETAIL_MESSAGES = {
    "recovery_required": "GPU 복구 확인이 필요합니다",
    "image_running": "이미지 생성이 끝난 뒤 다시 시도하세요",
    "manual_approval": "관리자 승인 후 사용할 수 있습니다",
}


def message_for(failure: Failure, detail: str | None) -> str:
    return DETAIL_MESSAGES.get(detail or "", FAILURE_MESSAGES[failure])


def credentials(token: str | None) -> str:
    """A stable per-credential unit for the C02-2 session limit.

    ``authenticate`` proves which key was used, but the router dependency does not
    return it. Hashing the token gives one bucket per credential without keeping
    the secret itself as a semaphore key.
    """
    return hashlib.sha256((token or "").encode()).hexdigest()[:32]


def proposal_client(request: Request) -> ProposalProviderClient:
    """The process-wide provider, created once on first use.

    Building it per request would reset the concurrency semaphores and void the
    global limit; keeping it on ``app.state`` also lets tests inject a transport.
    """
    s = state(request)
    client = getattr(s, "proposal_client", None)
    if client is None:
        client = ProposalProviderClient(s.settings)
        s.proposal_client = client
    return client


def dictionary_for(request: Request) -> ProposalDictionary | None:
    """Cache the mirror per process: it only changes with a deployment."""
    s = state(request)
    return cached(s, s.settings)


def advertised(settings, dictionary: ProposalDictionary | None) -> bool:
    """Whether this process can actually serve a proposal (see the service)."""
    return proposals_advertised(settings, dictionary)


def unavailable(failure: Failure, detail: str | None = None, *, latency_ms: int = 0,
                proposal: ValidatedProposal | None = None,
                kind: str | None = None) -> JSONResponse:
    """C02-4: failures are 200 with an explanatory status, never a 5xx."""
    body = {
        "status": "unavailable",
        "why": failure,
        "message": message_for(failure, detail),
        "detail": detail,
        "latency_ms": latency_ms,
        "suggestions": [],
        "unresolved_spans": [],
        "ambiguities": [],
        "rejected": [],
        "truncated": False,
    }
    if kind is not None:
        # Let the browser check the echoed kind even on a failure envelope.
        body["kind"] = kind
    if kind == VARIANT_KIND:
        # VAR01 keeps one reply shape per kind: an empty candidate list, never a
        # missing key, so the card area can clear itself without guessing.
        body["variants"] = []
    if proposal is not None:
        # C01-3 keeps the diagnostic spans the validator did establish, so the user
        # still sees what was not understood, while suggestions stay empty.
        body["unresolved_spans"] = [dict(span) for span in proposal.unresolved_spans]
        body["ambiguities"] = [dict(item) for item in proposal.ambiguities]
        body["rejected"] = [dict(item) for item in proposal.rejected]
        body["truncated"] = proposal.truncated
    return JSONResponse(body)


def serialize(proposal: ValidatedProposal, *, request: ProposalRequest) -> dict:
    """The browser reply in the C01-3 shape.

    ``polarity``/``actor`` are fixed to ``affirmed``/``None``: the validator only
    accepts those (negated and attributed items move to spans/ambiguities).
    ``proposal_id`` is echoed for the "이력은 저장되지 않습니다" notice; it is not
    persisted (C02-5).
    """
    return {
        "proposal_id": proposal.proposal_id,
        "request_id": request.request_id,
        "status": proposal.status,
        "kind": request.kind,
        "provider": (proposal.provider.model_dump(mode="json")
                     if proposal.provider is not None else None),
        "revisions": request.revisions.model_dump(mode="json"),
        "suggestions": [
            {
                "id": item.id, "matched_phrase": item.matched_phrase, "basis": item.basis,
                "polarity": "affirmed", "actor": None, "confidence": item.confidence,
                "reason_ko": item.reason_ko,
            }
            for item in proposal.suggestions
        ],
        # VAR01: only `situation_variants` ever fills this, and the field is omitted
        # for the two older kinds so their reply stays byte-identical to C01/I06.
        **({"variants": [
            {
                "variant_id": item.variant_id, "label_ko": item.label_ko,
                "prompt_ko": item.prompt_ko, "changed_ids": list(item.changed_ids),
                "removed_ids": list(item.removed_ids),
                "unresolved_ko": list(item.unresolved_ko), "actor": None,
            }
            for item in proposal.variants
        ]} if request.kind == VARIANT_KIND else {}),
        "unresolved_spans": [dict(span) for span in proposal.unresolved_spans],
        "ambiguities": [dict(item) for item in proposal.ambiguities],
        "rejected": [dict(item) for item in proposal.rejected],
        "truncated": proposal.truncated,
    }


def encoded_size(body: dict) -> int:
    return len(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


@router.post("/proposals")
async def create_proposal(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
):
    """One explicit proposal attempt: no retries, no queue, no stored history."""
    s = state(request)
    dictionary = dictionary_for(request)
    if not advertised(s.settings, dictionary):
        # Nothing below can succeed without a gate, a model or a dictionary.
        return unavailable("not_configured", "capability_not_advertised")

    raw = await request.body()
    if len(raw) > MAX_REQUEST_BYTES:
        # C02-2: a 413 is a transport fact, so the client must not retry blindly.
        raise HTTPException(413, "Proposal request body exceeds 8192 bytes")
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(422, "Proposal request is not valid JSON") from None
    if not isinstance(body, dict):
        raise HTTPException(422, "Proposal request must be a JSON object")
    kind = body.get("kind")
    if kind not in SUPPORTED_KINDS:
        # C01-4: an unknown kind is a documented non-support answer, not a defect.
        return {
            "status": "unsupported_v1",
            "kind": kind if isinstance(kind, str) else None,
            "why": "kind_unsupported_v1",
            "message": "이 제안 종류는 아직 지원하지 않습니다",
            "suggestions": [],
            "unresolved_spans": [],
            "ambiguities": [],
            "rejected": [],
            "truncated": False,
        }
    try:
        proposal_request = ProposalRequest.model_validate(body)
    except ValueError as error:
        # The schema is the client's contract; a malformed request is a 422 even
        # though provider failures are 200.
        raise HTTPException(422, f"Invalid proposal request: {error}") from None

    outcome = await proposal_client(request).propose(
        proposal_request,
        session=credentials(
            authorization.removeprefix("Bearer ") if authorization else None
        ),
        # Read the live scheduler/GPU state; nothing here changes it (C02-3).
        mode=s.scheduler.mode,
        blocked=s.gpu.blocked,
        leased=s.gpu.leased,
        model=s.settings.llm_model,
        dictionary=dictionary.entries,
        dictionary_version=dictionary.version,
        request_bytes=len(raw),
    )
    if outcome.failure is not None:
        return unavailable(outcome.failure, outcome.detail,
                           latency_ms=outcome.latency_ms, proposal=outcome.proposal,
                           kind=proposal_request.kind)
    reply = serialize(outcome.proposal, request=proposal_request)
    if reply["provider"] is not None:
        # The model cannot measure its own round trip; the server can.
        reply["provider"]["latency_ms"] = outcome.latency_ms
    if encoded_size(reply) > MAX_RESPONSE_BYTES:
        # C01-5: the budget is a hard cap. The validator already trimmed its own
        # items, so an over-budget envelope is an endpoint defect, not something
        # the client should silently trim.
        return unavailable("invalid_reply", "reply_exceeds_budget",
                           latency_ms=outcome.latency_ms, kind=proposal_request.kind)
    return reply

