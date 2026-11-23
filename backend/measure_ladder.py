"""UCP07 measurement harness: the trim ladder's real byte sizes.

Not part of the test suite — the *pinned* version of these numbers lives in
``tests/test_prompt_composition_v3.py``. This script exists so the doc's table can be
re-measured by hand instead of copied forward.
"""

import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.prompt_snapshot import (  # noqa: E402
    LADDER,
    MAX_SNAPSHOT_BYTES,
    _step,
    fit_payload,
    payload_size,
)


def worst_case():
    """Every semantic cap filled at once."""
    entities = [
        {"entity_id": f"entity-{i}", "kind": "person", "count": 16,
         "attributes_ko": ["가" * 200] * 8, "evidence_ko": "나" * 200}
        for i in range(1, 9)
    ]
    relations = [
        {"subject_entity_id": f"entity-{(i % 8) + 1}", "predicate_ko": "다" * 200,
         "object_entity_id": f"entity-{((i + 1) % 8) + 1}", "evidence_ko": "라" * 200}
        for i in range(12)
    ]
    selections = []
    for i in range(100):
        if i % 5 == 0:
            selections.append({"id": f"d.entry{i}", "source": "excluded"})
        else:
            selections.append({"id": f"d.entry{i}", "source": "manual", "pinned": True,
                               "entity_id": f"entity-{(i % 8) + 1}"})
    return {
        "schema_version": 3, "compiler_version": "1.3.0",
        "dictionary_version": "1.2.0", "target_model_id": "m" * 100,
        "target_family": "f" * 100, "profile_version": 1,
        "brief_ko": "사" * 4000,
        "selections": selections,
        "scene": {"entities": entities, "relations": relations,
                  "environment": {k: "아" * 200 for k in
                                  ("location_ko", "time_ko", "lighting_ko",
                                   "composition_ko", "style_ko", "mood_ko")},
                  "unmapped_details": [{"text_ko": "마" * 200, "entity_id": "entity-1"}
                                       for _ in range(8)],
                  "ambiguities": [{"text_ko": "바" * 200, "why": "actor_unknown",
                                   "options": [f"entity-{i}" for i in range(1, 7)]}
                                  for _ in range(8)]},
        "applied": {"result_id": "cmp-0123456789ab", "candidate_id": "c" * 64,
                    "provider_model": "p" * 200,
                    "applied_at": "2026-11-22T00:00:00Z",
                    "positive_prompt": "b" * 8000, "negative_prompt": "n" * 4000,
                    "summary_ko": "자" * 600},
        "snapshot_trim": [],
    }


def main():
    payload = worst_case()
    size = payload_size(payload)
    print(f"{'step':<20} {'cumulative':>11} {'delta':>8}")
    print(f"{'(none)':<20} {size:>11,} {'-':>8}")
    for name in LADDER:
        before = size
        changed = _step(name, payload)
        size = payload_size(payload)
        print(f"{name:<20} {size:>11,} {before - size:>8,}"
              f"{'' if changed else '  (no-op)'}")
    print(f"\nbudget {MAX_SNAPSHOT_BYTES:,}  fits={size <= MAX_SNAPSHOT_BYTES}")
    print("excluded rows kept:",
          sum(1 for item in payload["selections"] if item["source"] == "excluded"),
          "/ 20")
    print("selection rows kept:", len(payload["selections"]))
    print("applied verbatim:", payload["applied"]["positive_prompt"] == "b" * 8000,
          payload["applied"]["negative_prompt"] == "n" * 4000)
    ids = {entity["entity_id"] for entity in payload["scene"]["entities"]}
    print("dangling attributions:",
          sum(1 for item in payload["selections"]
              if item.get("entity_id") is not None and item["entity_id"] not in ids))
    first = fit_payload(copy.deepcopy(worst_case()))
    second = fit_payload(copy.deepcopy(worst_case()))
    print("deterministic:", (first[1], first[2]) == (second[1], second[2]),
          first[1])


if __name__ == "__main__":
    main()
