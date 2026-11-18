"""Server-side provider for scene proposals (LLM-I02).

One explicit call per user action: no retries, no streaming, no background loop.
The transport is injected so tests never touch a GPU or a socket. Nothing in this
module starts, stops, pauses or resumes the LLM: availability is *read* from the
existing scheduler/GPU state and the gate, never changed (C02-3).
"""

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Literal, Mapping
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.services.prompt_proposals import (
    MAX_VARIANTS,
    VARIANT_KIND,
    DictionaryEntryRef,
    ProposalRequest,
    ValidatedProposal,
    evaluate,
)

# C02-2: a proposal must not wait for an image transition boundary.
PROPOSAL_TIMEOUT_SECONDS = 20.0
PROPOSAL_CONNECT_TIMEOUT = 5.0
# C02-2: per session 1, global 2, zero while an image job runs.
SESSION_LIMIT = 1
GLOBAL_LIMIT = 2
# docs/LLM_GATE.md: Qwen spent a small budget in ``reasoning_content`` and ended
# with ``finish_reason: length``. A bounded but sufficient budget keeps the reply
# usable; a length finish is still discarded by the validator.
PROPOSAL_MAX_TOKENS = 1024

Failure = Literal[
    "not_configured",
    "stale_dictionary",
    "request_too_large",
    "gpu_unavailable",
    "admission_paused",
    "gate_unreachable",
    "upstream_status",
    "timeout",
    "cancelled",
    "invalid_reply",
    "busy",
]

# C02-2: the proposal request itself is capped at 8 KiB even though BodyLimit
# allows 64 KiB for image jobs.
MAX_REQUEST_BYTES = 8 * 1024


@dataclass(frozen=True)
class ProposalOutcome:
    """Either a validated proposal or exactly one failure code, never both."""

    proposal: ValidatedProposal | None = None
    failure: Failure | None = None
    # Short machine-readable reason for the UI (C02-3 rows have distinct messages).
    detail: str | None = None
    latency_ms: int = 0

    @property
    def ok(self) -> bool:
        return (self.proposal is not None and self.failure is None
                and self.proposal.status in {"ready", "empty"})


def _failure(code: Failure, detail: str | None = None, latency_ms: int = 0) -> ProposalOutcome:
    return ProposalOutcome(failure=code, detail=detail, latency_ms=latency_ms)


def proposals_enabled(settings) -> bool:
    """C02-4: advertise proposals only when the gate is configured on a real engine.

    ``engine == "fake"`` has no llama and no verified gate, so advertising there
    would expose a button that always fails.
    """
    return bool(getattr(settings, "admission_url", "")) and settings.engine != "fake"


def data_base_url(admission_url: str) -> str:
    """Derive the gate data origin from the stored ``/control`` URL.

    ``STUDIO_ADMISSION_URL`` is documented as ``http://127.0.0.1:8081/control``
    (docs/LLM_GATE.md). The data path shares the listener but not the credential,
    so the control path is stripped instead of inventing a second setting.
    """
    parts = urlsplit(admission_url)
    path = parts.path.rstrip("/")
    if path.endswith("/control"):
        path = path[: -len("/control")]
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def availability_failure(mode: str, *, blocked: bool, leased: bool) -> tuple[Failure, str] | None:
    """C02-3 decision table, decided without any network access.

    ``manual`` needs an administrator grant before GPU work, so a proposal is
    refused instead of silently borrowing the GPU.
    """
    if blocked:
        return ("gpu_unavailable", "recovery_required")
    if leased:
        return ("gpu_unavailable", "image_running")
    if mode == "manual":
        return ("gpu_unavailable", "manual_approval")
    return None


def proposals_advertised(settings, dictionary) -> bool:
    """C02-4, narrowed to conditions that can actually serve a proposal.

    ``proposals_enabled`` already drops ``fake`` and an unset gate. A missing
    dictionary mirror or an empty ``llm_model`` are installation defects that would
    make every call fail, so the button must not appear for them either.
    """
    return (proposals_enabled(settings) and dictionary is not None
            and bool(getattr(settings, "llm_model", "")))


def _dictionary_listing(dictionary: Mapping[str, DictionaryEntryRef]) -> str:
    """List the IDs the model may use: the dictionary is the whitelist.

    Only active entries are listed, so an inactive ID is never offered. The model
    still sees no rendered text; acceptance maps back to an ID and ``compileScene``
    assembles the final prompt.
    """
    lines = [
        f"- {entry_id} ({ref.category})"
        for entry_id, ref in sorted(dictionary.items())
        if ref.active
    ]
    return "\n".join(lines)


def _variant_schema(request: ProposalRequest, *, model: str) -> dict:
    """VAR01: the reply shape for ``situation_variants``.

    ``suggestions`` stays in the schema as an empty list so one model reply always
    has the same envelope; the id-only shape would let a hint reply pass for a
    candidate reply, and the validator would have to guess which one it received.
    """
    return {
        "proposal_id": "string",
        "request_id": request.request_id,
        "status": "ready | empty | unavailable | unsupported_v1",
        "kind": request.kind,
        "provider": {"model": model, "version": "", "latency_ms": 0,
                     "finish_reason": "stop"},
        "revisions": request.revisions.model_dump(mode="json"),
        "suggestions": [],
        "variants": [{
            "variant_id": "v1 | v2 | v3",
            "label_ko": "<short Korean label, <= 40 chars>",
            "prompt_ko": "<one Korean sentence, <= 200 chars>",
            "changed_ids": ["<dictionary id for a new place or action>"],
            "removed_ids": ["<currently selected place or action id being replaced>"],
            "unresolved_ko": ["<Korean words the dictionary cannot express>"],
            "actor": None,
        }],
        "unresolved_spans": [],
        "ambiguities": [],
        "rejected": [],
        "truncated": False,
    }


def _variant_system(schema: dict, catalogue: str) -> str:
    return (
        "You propose at most three different SITUATIONS for the same scene. "
        "Reply with one JSON object only, matching this shape exactly:\n"
        + json.dumps(schema, ensure_ascii=False)
        + "\nRules: keep the person, outfit and style exactly as selected; change "
        "only place (setting) and action (pose). Each variant needs a Korean "
        "sentence the user can read, and its changed_ids/removed_ids must be the "
        "IDs that sentence actually swaps. Put Korean words the dictionary cannot "
        "express in unresolved_ko instead of inventing IDs, and never set actor: "
        "one flat scene cannot say who owns an attribute. Use only IDs from the "
        "dictionary list, difference each variant from the current selection, "
        "never repeat a variant, never explain."
        "\nDictionary:\n" + catalogue
    )


def build_payload(
    request: ProposalRequest,
    *,
    model: str,
    dictionary: Mapping[str, DictionaryEntryRef],
) -> dict:
    """The single chat request. ``free_text_ko`` is data, never an instruction."""
    catalogue = _dictionary_listing(dictionary)
    if request.kind == VARIANT_KIND:
        schema = _variant_schema(request, model=model)
        system = _variant_system(schema, catalogue)
        # A variant is a diff, so the model needs the selection it must keep and the
        # values it may replace. For the older kinds the selection is already in the
        # text and the payload stays as C01 fixed it.
        user = {
            "kind": request.kind,
            "target_family": request.target_family,
            "free_text_ko": request.free_text_ko,
            "selections": [{"id": item.id, "category": item.category}
                           for item in request.selections],
            "locked_ids": request.locked_ids,
            "target_groups": request.target_groups,
            "max_variants": MAX_VARIANTS,
        }
    else:
        schema = {
            "proposal_id": "string",
            "request_id": request.request_id,
            "status": "ready | empty | unavailable | unsupported_v1",
            "kind": request.kind,
            "provider": {"model": model, "version": "", "latency_ms": 0,
                         "finish_reason": "stop"},
            "revisions": request.revisions.model_dump(mode="json"),
            "suggestions": [{"id": "<dictionary id>", "matched_phrase": "<exact substring>",
                             "basis": "quote | inferred", "polarity": "affirmed | negated",
                             "actor": None, "confidence": 0.0, "reason_ko": ""}],
            "unresolved_spans": [{"text": "<exact substring>", "why": "no_dictionary_entry",
                                  "polarity": "affirmed"}],
            "ambiguities": [{"text": "<exact substring>", "why": "actor_unknown",
                             "candidates": []}],
            "rejected": [], "truncated": False,
        }
        system = (
            "You map a Korean scene description to dictionary entry IDs. "
            "Reply with one JSON object only, matching this shape exactly:\n"
            + json.dumps(schema, ensure_ascii=False)
            + "\nRules: use only IDs from the dictionary list; copy matched_phrase and "
            "span text verbatim from the user text; never invent IDs; never explain."
            "\nDictionary:\n" + catalogue
        )
        user = {"kind": request.kind, "target_family": request.target_family,
                "free_text_ko": request.free_text_ko,
                "locked_ids": request.locked_ids, "target_groups": request.target_groups}
    return {
        "model": model,
        "max_tokens": PROPOSAL_MAX_TOKENS,
        "stream": False,
        # Qwen reasoning would consume the budget without producing the object.
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ],
    }


def reply_bytes(body: bytes) -> bytes:
    """Extract the assistant message content from an OpenAI-shaped chat reply.

    A malformed envelope is reported as ``invalid_reply`` by the caller, never as
    a crash: the browser must keep its text and selections untouched.
    """
    try:
        value = json.loads(body)
        content = value["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise ValueError("provider reply is not an OpenAI chat reply") from error
    if not isinstance(content, str):
        raise ValueError("provider reply content is not a string")
    return content.encode("utf-8")


class ProposalProviderClient:
    """One bounded proposal call through the gate (C02-1 path).

    The transport is injected so tests use ``httpx.MockTransport`` and never reach
    the GPU. The client holds its own semaphore: the gate only counts requests, it
    does not limit them (C02-2).
    """

    def __init__(self, settings, *, transport: httpx.AsyncBaseTransport | None = None,
                 timeout: float = PROPOSAL_TIMEOUT_SECONDS):
        self.s = settings
        self._transport = transport
        self._timeout = timeout
        self._global = asyncio.Semaphore(GLOBAL_LIMIT)
        self._sessions: dict[str, asyncio.Semaphore] = {}

    def _session(self, session: str) -> asyncio.Semaphore:
        semaphore = self._sessions.get(session)
        if semaphore is None:
            semaphore = asyncio.Semaphore(SESSION_LIMIT)
            self._sessions[session] = semaphore
        return semaphore

    def _headers(self) -> dict[str, str]:
        # Only the LLM key, never the gate control key: the data path does not
        # validate credentials itself (C02-1).
        return ({"Authorization": f"Bearer {self.s.llm_api_key}"}
                if self.s.llm_api_key else {})

    async def _gate_state(self, client: httpx.AsyncClient) -> dict:
        headers = {"Authorization": f"Bearer {self.s.admission_key}"}
        response = await client.request("GET", self.s.admission_url, headers=headers)
        response.raise_for_status()
        value = response.json()
        if not isinstance(value, dict) or type(value.get("paused")) is not bool:
            raise ValueError("Admission gate returned an invalid state")
        return value

    async def _post(self, client: httpx.AsyncClient, payload: dict) -> httpx.Response:
        url = data_base_url(self.s.admission_url).rstrip("/") + "/v1/chat/completions"
        return await client.request("POST", url, json=payload, headers=self._headers())

    async def _call(self, request: ProposalRequest, model: str,
                    dictionary: Mapping[str, DictionaryEntryRef]) -> ProposalOutcome:
        started = time.monotonic()
        payload = build_payload(request, model=model, dictionary=dictionary)
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=httpx.Timeout(self._timeout),
                trust_env=False,
            ) as client:
                gate = await self._gate_state(client)
                if gate["paused"]:
                    # C02-3: a hold means the LLM is paused for image work.
                    return _failure("admission_paused", "gate_paused")
                response = await self._post(client, payload)
        except httpx.HTTPError as error:
            return _failure("gate_unreachable", type(error).__name__,
                            int((time.monotonic() - started) * 1000))
        except ValueError as error:
            # Only the control state can raise here: an unknown gate shape is a
            # gate problem, not a model reply. It must never look like invalid_reply.
            return _failure("gate_unreachable", f"invalid_gate_state: {error}",
                            int((time.monotonic() - started) * 1000))
        latency = int((time.monotonic() - started) * 1000)
        if response.status_code != 200:
            return _failure("upstream_status", f"http_{response.status_code}", latency)
        try:
            content = reply_bytes(response.content)
        except ValueError as error:
            return _failure("invalid_reply", str(error), latency)
        result = evaluate(content, request=request, dictionary=dictionary)
        if result.status not in {"ready", "empty"}:
            # C01-3: the browser gets an informative status, not a 5xx.
            return ProposalOutcome(proposal=result, failure="invalid_reply",
                                   detail=result.why, latency_ms=latency)
        return ProposalOutcome(proposal=result, latency_ms=latency)

    def _request_size(self, request: ProposalRequest) -> int:
        """Byte length of what the browser would send for this request (C02-2 8 KiB)."""
        return len(json.dumps(request.model_dump(mode="json"), ensure_ascii=False)
                   .encode("utf-8"))

    async def propose(
        self,
        request: ProposalRequest,
        *,
        session: str,
        mode: str,
        blocked: bool,
        leased: bool,
        model: str,
        dictionary: Mapping[str, DictionaryEntryRef],
        dictionary_version: str,
        request_bytes: int | None = None,
    ) -> ProposalOutcome:
        """One attempt: no retry, no queueing, no GPU state mutation."""
        if not proposals_enabled(self.s):
            return _failure("not_configured", "capability_not_advertised")
        size = self._request_size(request) if request_bytes is None else request_bytes
        if size > MAX_REQUEST_BYTES:
            # C02-2: the endpoint cap is 8 KiB, not the image job's 64 KiB body limit.
            return _failure("request_too_large", f"max_{MAX_REQUEST_BYTES}")
        if request.dictionary_version != dictionary_version:
            # I01 handover: a reply validated against another dictionary revision
            # could accept an ID the browser does not have.
            return _failure("stale_dictionary", "client_dictionary_outdated")
        unavailable = availability_failure(mode, blocked=blocked, leased=leased)
        if unavailable is not None:
            return _failure(*unavailable)
        if self._global.locked() or self._session(session).locked():
            # Refuse instead of queueing: a queued proposal would outlive both the
            # user's patience and the 20 s budget.
            return _failure("busy", "concurrent_request")
        async with self._global, self._session(session):
            task = asyncio.create_task(self._call(request, model, dictionary))
            try:
                return await asyncio.wait_for(asyncio.shield(task), self._timeout)
            except TimeoutError:
                # Drop the late result: the browser must not adopt it.
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                return _failure("timeout", f"{int(self._timeout * 1000)}_ms")
            except asyncio.CancelledError:
                # Browser aborted: disconnect the gate call and store nothing.
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                return _failure("cancelled", "client_disconnected")
