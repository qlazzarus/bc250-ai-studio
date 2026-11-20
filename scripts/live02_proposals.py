#!/usr/bin/env python3
"""LIVE02: measure what a *real* provider answers, then report it as unverified-or-fact.

Why this file exists separately from the browser suites: every other harness in this repo
stubs the proposal reply, so nothing in it can say anything about translation quality.
This script calls the real endpoint once per case and records what came back — latency,
provider envelope, accepted/rejected counts — plus, for translations, the judgement a
human has to make (meaning kept? dropped?).

It refuses to run without a configured gate, so a stub run can never be recorded here:

    STUDIO_API_KEY=... STUDIO_BASE_URL=http://127.0.0.1:18080 \
        uv run python scripts/live02_proposals.py --out docs/evidence/live02

Exit codes: 0 = every case ran, 2 = environment refused (nothing measured), 3 = a case
returned an unexpected status. Nothing is retried: one attempt per case is the contract.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

# Twelve scenes is EVAL-UX02's denominator; here they are only the input text.
SCENES = [
    ("일상", "비 오는 골목에 서 있는 사람과 우산"),
    ("제품", "하얀 배경 위에 놓인 세라믹 컵, 부드러운 조명"),
    ("풍경", "해질 무렵 바다를 바라보는 언덕"),
    ("부정", "사람은 없고 비어 있는 사무실 의자만"),
    ("색", "짙은 녹색 코트를 입은 여성, 흐린 날"),
    ("구도", "얼굴 클로즈업, 정면, 얕은 심도"),
    ("행동", "계단을 뛰어 내려가는 아이"),
    ("분위기", "축축한 공기가 느껴지는 새벽 시장"),
    ("혼합", "네온이 비치는 골목에 선 사람과 개, 그리고 멀리 보이는 다리"),
    ("없는 사물", "우주선 안의 조종석, 창밖으로 보이는 토성"),
    ("긴 문장", "비를 맞으며 버스를 기다리는 사람들, 젖은 재킷, 흐릿한 가로등, "
                "멀리 지나가는 자동차 불빛"),
    ("모호", "그거 좀 예쁘게"),
]


def request(base, key, path, payload, timeout=60):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{base.rstrip('/')}{path}", data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return {"status": response.status, "ms": int((time.monotonic() - started) * 1000),
                    "body": json.loads(raw) if raw else {}}
    except urllib.error.HTTPError as error:
        raw = error.read()
        return {"status": error.code, "ms": int((time.monotonic() - started) * 1000),
                "body": raw.decode("utf-8", "replace")[:2000]}
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        return {"status": None, "ms": int((time.monotonic() - started) * 1000),
                "error": f"{type(error).__name__}: {error}"}


def capabilities(base, key):
    req = urllib.request.Request(f"{base.rstrip('/')}/api/v1/system/capabilities",
                                headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read())


def request_id():
    return "live02-" + uuid.uuid4().hex[:16]


def selection_request(scene):
    return {
        "kind": "selection_hint", "request_id": request_id(), "target_family": "sd15",
        "dictionary_version": "1.2.0", "free_text_ko": scene,
        "selections": [], "locked_ids": [], "target_groups": [],
        "revisions": {"scene": 1, "selection": 0, "free_text": 1},
    }


def translation_request(scene, phrase):
    return {
        "kind": "remainder_translation", "request_id": request_id(),
        "target_family": "sd15", "dictionary_version": "1.2.0", "free_text_ko": scene,
        "selections": [], "locked_ids": [], "target_groups": [],
        "revisions": {"scene": 1, "selection": 0, "free_text": 1},
        "remainder_spans": [{"start": scene.index(phrase),
                             "end": scene.index(phrase) + len(phrase)}],
    }


TRANSLATION_PHRASES = [
    "네온이 비치는 골목에 선",
    "축축한 공기가 느껴지는 새벽 시장",
    "멀리 지나가는 자동차 불빛",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="docs/evidence/live02")
    parser.add_argument("--base", default=os.environ.get("STUDIO_BASE_URL", ""))
    args = parser.parse_args()

    key = os.environ.get("STUDIO_API_KEY", "")
    if not key or not args.base:
        print("refused: STUDIO_API_KEY and STUDIO_BASE_URL are required; "
              "nothing was measured and no file was written", file=sys.stderr)
        return 2

    try:
        caps = capabilities(args.base, key)
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        print(f"refused: capabilities unreachable ({error}); nothing was measured",
              file=sys.stderr)
        return 2
    # The single most important gate: no advertised proposals means there is no provider
    # behind this server, so every 200 below would be a stub or a failure envelope.
    if "prompt_proposals" not in caps:
        print("refused: this server does not advertise prompt_proposals "
              f"(engine={caps.get('engine')!r}); a fake or unconfigured deployment cannot "
              "produce live evidence", file=sys.stderr)
        return 2

    report = {
        "environment": {"base": args.base, "engine": caps.get("engine"),
                        "advertised": caps["prompt_proposals"],
                        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        "selection_hint": [], "remainder_translation": [], "failures": 0,
    }

    for label, scene in SCENES:
        result = request(args.base, key, "/api/v1/prompt/proposals", selection_request(scene))
        body = result.get("body") if isinstance(result.get("body"), dict) else {}
        entry = {
            "scene": label, "text_ko": scene, "status": result["status"], "ms": result["ms"],
            "outcome": body.get("status"), "provider": body.get("provider"),
            "suggestions": len(body.get("suggestions") or []),
            "rejected": len(body.get("rejected") or []),
            "ambiguities": len(body.get("ambiguities") or []),
            "proposal_kind_matches": body.get("kind") == "selection_hint",
        }
        if body.get("why"):
            entry["why"] = body["why"]
        if result["status"] != 200 or entry["outcome"] != "ready":
            report["failures"] += 1
        report["selection_hint"].append(entry)
        print(f"selection_hint · {label} · {result['status']} · {result['ms']}ms "
              f"· {entry['outcome']} · {entry['suggestions']} suggestions")

    for phrase in TRANSLATION_PHRASES:
        scene = f"네온이 비치는 골목에 선 사람, 그리고 {phrase}"
        if phrase not in scene:
            scene = f"{phrase} 사람"
        result = request(args.base, key, "/api/v1/prompt/proposals",
                         translation_request(scene, phrase))
        body = result.get("body") if isinstance(result.get("body"), dict) else {}
        translations = body.get("translations") or []
        entry = {
            "source_ko": phrase, "status": result["status"], "ms": result["ms"],
            "outcome": body.get("status"), "provider": body.get("provider"),
            "translations": translations, "unresolved_spans": body.get("unresolved_spans"),
            "rejected": body.get("rejected"),
            # Explicitly not filled in by this script: a script cannot judge meaning.
            "human_review": {"meaning_preserved": None, "natural_english": None,
                             "omitted": None, "notes": None},
        }
        if result["status"] != 200 or entry["outcome"] != "ready":
            report["failures"] += 1
        report["remainder_translation"].append(entry)
        print(f"remainder_translation · {phrase} · {result['status']} · {result['ms']}ms "
              f"· {entry['outcome']} · {len(translations)} translations")

    report["verdict"] = {
        "measured": "provider latency, envelope, counts and raw translations",
        "not_measured": "meaning preservation, naturalness, image-prompt fitness "
                        "(human, EVAL-UX02)",
        "note": "a 'ready' outcome is not a quality claim; see human_review per case",
    }
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, "results.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(f"\nwrote {path} · failures={report['failures']}")
    return 3 if report["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())

