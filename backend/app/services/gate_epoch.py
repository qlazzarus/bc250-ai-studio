"""Gate model snapshot and epoch (LLM-I03).

The gate rejects a data request that cannot name the epoch it was built for:

    409 {"detail": "model_epoch_mismatch"}

That is deliberate. A request prepared for one GPU owner must not be forwarded
after ownership changed. The header is ``X-Model-Epoch``; the value comes from
``GET /model-snapshot`` on the same listener.

Three measured facts decide this module's shape:

* The epoch rises on any ``switch-`` or ``studio-`` hold, so it marks **GPU
  ownership**, not just the weights: Studio's own image jobs bump it. A value
  cached at start-up or per process is stale the moment image work begins, so it
  is read before every call.
* ``/model-snapshot`` takes no hold — it reports state and proxies ``/v1/models``
  without ``enter()`` — so asking for the epoch cannot occupy the GPU.
* A window remains between the snapshot and the chat call in which the epoch can
  change. That window is the feature: the answer is the 409 the gate returns,
  reported to the caller. Nothing here retries, and nothing here caches.
"""

import re

import httpx

# The gate mints ``secrets.token_hex(16)``; the LLM client validates 32 hex too.
# A value that does not match is a contract break: report it, do not forward it.
EPOCH_PATTERN = re.compile(r"[0-9a-f]{32}\Z")

# The gate tags a 409 it generated itself, so an epoch rejection can be told apart
# from a 409 produced further upstream.
ADMISSION_HEADER = "X-BC250-Admission"

# The gate's own reason string, also used as the body ``detail``.
EPOCH_MISMATCH = "model_epoch_mismatch"


class SnapshotError(Exception):
    """The gate could not give a usable snapshot.

    ``failure`` is one of the providers' existing failure codes, so a snapshot
    problem reuses the established vocabulary instead of inventing a status the
    API layer and the browser do not know. None of these may become
    ``invalid_reply``: the model was never asked anything.
    """

    def __init__(self, failure: str, detail: str):
        super().__init__(detail)
        self.failure = failure
        self.detail = detail


def snapshot_url(admission_url: str) -> str:
    """``/model-snapshot`` on the gate data origin.

    ``data_base_url`` stays the single place that derives the origin from the
    stored ``/control`` URL; importing it here, rather than copying the logic,
    keeps both providers and this module from drifting apart.
    """
    from app.services.proposal_provider import data_base_url

    return data_base_url(admission_url).rstrip("/") + "/model-snapshot"


async def read_snapshot(client: httpx.AsyncClient,
                        admission_url: str) -> tuple[str, list[str]]:
    """Return ``(epoch, model_ids)``, or raise ``SnapshotError``.

    One request, one decision: a retry here would only ask the same question again
    while the GPU state is still moving.
    """
    try:
        response = await client.request("GET", snapshot_url(admission_url))
    except httpx.HTTPError as error:
        raise SnapshotError("gate_unreachable",
                            f"snapshot_{type(error).__name__}") from error

    if response.status_code == 409:
        # Paused, or the gate's own state moved while it was answering. Both mean
        # "do not send the inference request now".
        raise SnapshotError("admission_paused", "snapshot_not_ready")
    if response.status_code != 200:
        raise SnapshotError("gate_unreachable", f"snapshot_http_{response.status_code}")

    try:
        value = response.json()
    except ValueError as error:
        raise SnapshotError("gate_unreachable", "snapshot_not_json") from error
    if not isinstance(value, dict):
        raise SnapshotError("gate_unreachable", "snapshot_invalid")

    if value.get("ready") is not True:
        # `ready: false` is the gate saying "not now"; anything else is a broken
        # reply, and an unreadable body must never read as permission to call.
        if value.get("ready") is False:
            raise SnapshotError("admission_paused", "snapshot_not_ready")
        raise SnapshotError("gate_unreachable", "snapshot_invalid")

    epoch = value.get("epoch")
    if not isinstance(epoch, str) or not EPOCH_PATTERN.fullmatch(epoch):
        raise SnapshotError("gate_unreachable", "snapshot_invalid_epoch")

    models = value.get("models")
    entries = models.get("data") if isinstance(models, dict) else None
    if not isinstance(entries, list):
        raise SnapshotError("gate_unreachable", "snapshot_invalid_models")
    model_ids = [item["id"] for item in entries
                 if isinstance(item, dict) and isinstance(item.get("id"), str)
                 and item["id"].strip()]
    if not model_ids:
        raise SnapshotError("gate_unreachable", "snapshot_no_model")
    return epoch, model_ids


async def epoch_for(client: httpx.AsyncClient, admission_url: str,
                    configured_model: str) -> str:
    """Return the epoch to send, or raise ``SnapshotError``.

    A model mismatch is reported as ``not_configured``: it is an installation defect,
    not a transient condition, so it gets the "this deployment cannot do it" code
    rather than a provider error. Sending the call anyway would be worse than
    failing — the server may answer for a model the caller did not ask for, and the
    reply would still look valid.
    """
    epoch, model_ids = await read_snapshot(client, admission_url)
    if configured_model not in model_ids:
        raise SnapshotError("not_configured",
                            f"configured_model_unavailable: served={model_ids[0]}")
    return epoch


def rejection_detail(response: httpx.Response) -> str | None:
    """The ``detail`` of an admission rejection, or ``None`` if this was not one.

    The gate marks its own rejections with ``X-BC250-Admission: rejected``. The
    body reason is accepted on its own too: the header is the documented signal,
    but a gate revision that omitted it must not turn a real epoch rejection into
    an anonymous ``http_409``.
    """
    if response.status_code != 409:
        return None
    try:
        value = response.json()
    except ValueError:
        value = None
    reason = None
    if isinstance(value, dict) and isinstance(value.get("detail"), str):
        reason = value["detail"] or None
    if response.headers.get(ADMISSION_HEADER) == "rejected":
        return reason or EPOCH_MISMATCH
    return reason if reason == EPOCH_MISMATCH else None

