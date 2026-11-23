"""UCP07: the snapshot trim ladder, as a deterministic dict transformation.

The v3 snapshot is capped at 32 KiB of UTF-8 (the only binding byte limit, TRANS01 §3.1).
The *semantic* caps (100 selections, 4,000-char brief, 8 entities x 8 attributes, ...) are
each individually legal but cannot all be filled at once, so a snapshot at every cap is
larger than the budget. Something has to give, and the contract decides *what* in a fixed
order rather than by whichever field happens to be biggest.

Why this module works on plain dicts:

- it must not import ``app.models.schemas``, because ``schemas`` calls into it. Sizes are
  measured exactly the way ``check_snapshot`` measures them, so "the record fits" means
  the same thing in both places.
- every step is a pure function of the payload, so the *same* over-budget snapshot always
  loses the *same* fields, in the same order. A test can assert the byte count at each
  step instead of trusting a narrative.

What the ladder will never remove, at any step:

- ``applied.positive_prompt`` / ``applied.negative_prompt`` / ``applied.summary_ko``.
  These are what was actually executed. If the record no longer matches the image, the
  record is a lie, so these fields are not negotiable.
- ``selections``, including every ``source: "excluded"`` row. An exclusion is the *only*
  evidence that stops an automatic chip from coming back, so dropping one silently
  re-enables something the user vetoed.
- ``target_model_id`` / ``target_family`` / ``profile_version`` / ``dictionary_version``.
  Without them a restored snapshot cannot be judged stale or current.

A snapshot that had to be trimmed is **not** a complete record, and ``snapshot_trim``
names what was lowered so the restore path can say so instead of inventing the missing
values from the visible ones.
"""

import json

MAX_SNAPSHOT_BYTES = 32_768

# The fixed order. Every name here is a member of ``TrimStep`` in ``app.models.schemas``;
# a name outside that literal would make the stored record unreadable on the way back.
LADDER = (
    "evidence_ko",          # 1. quotes: evidence for *why*, not a fact the prompt needs
    "ambiguity_options",    # 2. options: recomputable from the surviving entities
    "attributes_first",     # 3. keep the first attribute of each entity
    "unmapped_text",        # 4. cap detail text (no-op unless legacy data was longer)
    "brief_2000",           # 5. keep the first 2,000 characters of the user's Korean
    "environment",          # 6. drop the six environment keys
    "arrays_2",             # 7. keep the two most important entities/relations/...
    "scene_dropped",        # 8. the whole scene
)


def encoded(payload: dict) -> str:
    """The canonical encoding every byte limit in this repo is measured against."""
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def payload_size(payload: dict) -> int:
    return len(encoded(payload).encode("utf-8"))


def _survivor_ids(scene: dict) -> set:
    return {entity["entity_id"] for entity in scene.get("entities", [])}


def drop_dangling(payload: dict) -> dict:
    """Remove every reference to an entity the scene no longer has.

    Trimming entities is the only step that can create a dangling reference, and a
    dangling reference is rejected outright by ``check_scene``. The choice here is
    *remove the reference*, not *keep the reference and drop validation*: an attribution
    to someone who is no longer in the scene is a claim the record cannot support.

    Selections are the exception and keep their row: ``entity_id`` becomes ``None``
    ("whole scene") because the chip itself is a user decision while its attribution is
    derived. Losing the attribution is recorded by the trim step that caused it — but the
    chip must not disappear.
    """
    scene = payload.get("scene", {})
    known = _survivor_ids(scene)
    scene["relations"] = [
        relation for relation in scene.get("relations", [])
        if relation["subject_entity_id"] in known
        and (relation.get("object_entity_id") is None
             or relation["object_entity_id"] in known)
    ]
    scene["unmapped_details"] = [
        item for item in scene.get("unmapped_details", [])
        if item.get("entity_id") is None or item["entity_id"] in known
    ]
    for ambiguity in scene.get("ambiguities", []):
        ambiguity["options"] = [
            option for option in ambiguity.get("options", []) if option in known
        ]
    for item in payload.get("selections", []):
        if item.get("entity_id") is not None and item["entity_id"] not in known:
            item["entity_id"] = None
    return payload


def _step(name: str, payload: dict) -> bool:
    """Apply one ladder step in place. Returns whether it changed anything."""
    scene = payload.setdefault("scene", {})
    if name == "evidence_ko":
        changed = False
        for entity in scene.get("entities", []):
            if entity.get("evidence_ko") is not None:
                entity["evidence_ko"] = None
                changed = True
        for relation in scene.get("relations", []):
            if relation.get("evidence_ko") is not None:
                relation["evidence_ko"] = None
                changed = True
        return changed
    if name == "ambiguity_options":
        changed = False
        for ambiguity in scene.get("ambiguities", []):
            if ambiguity.get("options"):
                ambiguity["options"] = []
                changed = True
        return changed
    if name == "attributes_first":
        changed = False
        for entity in scene.get("entities", []):
            if len(entity.get("attributes_ko", [])) > 1:
                entity["attributes_ko"] = entity["attributes_ko"][:1]
                changed = True
        return changed
    if name == "unmapped_text":
        changed = False
        for item in scene.get("unmapped_details", []):
            if len(item.get("text_ko", "")) > 200:
                item["text_ko"] = item["text_ko"][:200]
                changed = True
        return changed
    if name == "brief_2000":
        if len(payload.get("brief_ko", "")) > 2000:
            payload["brief_ko"] = payload["brief_ko"][:2000]
            return True
        return False
    if name == "environment":
        environment = scene.get("environment") or {}
        if any(value is not None for value in environment.values()):
            scene["environment"] = {}
            return True
        return False
    if name == "arrays_2":
        changed = False
        for key in ("entities", "relations", "unmapped_details", "ambiguities"):
            if len(scene.get(key, [])) > 2:
                scene[key] = scene[key][:2]
                changed = True
        # Cutting entities is what can dangle a reference, so the prune runs with this
        # step rather than as a step of its own. It is not reported separately: it is
        # part of what "keep two entities" means, not a second decision.
        drop_dangling(payload)
        return changed
    if name == "scene_dropped":
        empty = (not scene.get("entities") and not scene.get("relations")
                 and not scene.get("unmapped_details") and not scene.get("ambiguities")
                 and not any((scene.get("environment") or {}).values()))
        if empty:
            return False
        payload["scene"] = {"entities": [], "relations": [], "environment": {},
                            "unmapped_details": [], "ambiguities": []}
        drop_dangling(payload)
        return True
    raise ValueError(f"Unknown trim step: {name}")


def fit_payload(payload: dict) -> tuple[dict, list[str], int]:
    """Lower ``payload`` until it fits. Returns ``(payload, steps, size)``.

    ``payload`` is mutated in place. ``steps`` names only the steps that *changed*
    something: a step with nothing to remove is not recorded, because ``snapshot_trim`` is
    read as "this field is absent, not empty" (UCP01 fix B) and an unperformed step would
    claim an absence that never happened.

    The caller still has to check the returned size. When even the last step leaves the
    payload over budget, the honest answer is a refusal carrying the byte count — not a
    snapshot cut in the middle of the user's Korean sentence.
    """
    steps: list[str] = []
    size = payload_size(payload)
    if size <= MAX_SNAPSHOT_BYTES:
        return payload, steps, size
    for name in LADDER:
        if _step(name, payload):
            steps.append(name)
        size = payload_size(payload)
        if size <= MAX_SNAPSHOT_BYTES:
            break
    return payload, steps, size
