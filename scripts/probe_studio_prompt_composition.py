#!/usr/bin/env python3
"""Read-only prompt-composition contract probe against a running Studio API.

Every job payload is intentionally invalid so the server must reject it; nothing
is enqueued and no GPU work happens. Only reads and 4xx responses are expected.
The API key comes from ``STUDIO_API_KEY`` and the origin from ``STUDIO_BASE_URL``.

    STUDIO_API_KEY=... STUDIO_BASE_URL=http://127.0.0.1:18080 \
        uv run python scripts/probe_studio_prompt_composition.py
"""

import argparse
import json
import os
import urllib.error
import urllib.request

SELECTION = {
    "id": "lighting.soft",
    "category": "lighting",
    "label_ko": "부드러운 조명",
    "dictionary_version": "1.2.0",
    "mapping_status": "mapped",
    "rendered": "soft lighting",
}


def composition(**overrides):
    value = {
        "schema_version": 1,
        "compiler_version": "1.2.0",
        "target_family": "sd15",
        "selections": [],
        "free_text_ko": "",
        "draft_prompt": "",
        "unresolved": [],
    }
    value.update(overrides)
    return value


def job(**overrides):
    value = {
        "job_type": "image.generate",
        "source": "nsfw",
        "model_id": "realistic-vision-v6",
        "prompt": "contract probe",
        "width": 512,
        "height": 512,
        "steps": 20,
        "seed": 1,
    }
    value.update(overrides)
    return value

# (name, payload, expected status, expected detail fragment or None)
CASES = [
    ("family mismatch", job(prompt_composition=composition(target_family="flux2")), 422,
     "family does not match"),
    ("extra composition field", job(prompt_composition=composition(evil=1)), 422,
     "Extra inputs"),
    ("unsupported schema_version", job(prompt_composition=composition(schema_version=2)), 422,
     "Input should be 1"),
    ("unknown top-level field", job(prompt_compostion=composition()), 422, "Extra inputs"),
    ("empty prompt", job(prompt="   "), 422, "Prompt must contain text"),
    ("NUL in prompt", job(prompt="a\x00b"), 422, "NUL"),
    ("duplicate selection ID",
     job(prompt_composition=composition(selections=[SELECTION, dict(SELECTION)])), 422,
     "Duplicate"),
    ("mapped without rendered", job(prompt_composition=composition(
        selections=[dict(SELECTION, rendered=None)])), 422, "requires a nonempty expression"),
    ("unavailable with rendered", job(prompt_composition=composition(
        selections=[dict(SELECTION, mapping_status="unavailable", rendered="x")])), 422,
     "must not include an expression"),
    ("label over 300 chars", job(prompt_composition=composition(
        selections=[dict(SELECTION, label_ko="가" * 301)])), 422, "at most 300"),
    ("draft over 8000 chars", job(prompt_composition=composition(
        draft_prompt="a" * 8001)), 422, "at most 8000"),
    ("unavailable model", job(model_id="fake", prompt_composition=composition(
        target_family="fake")), 422, "disabled"),
    ("unsupported resolution", job(width=1000, height=1000), 422, "resolution"),
    ("negative_prompt on flux2", job(model_id="klein-4b-q4", negative_prompt="blurry",
                                    prompt_composition=composition(target_family="flux2")),
     422, "negative_prompt"),
    ("invalid token", job(), 401, "Invalid token"),
]




def call(base, key, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f"{base}{path}", data=data, method=method)
    request.add_header("Authorization", f"Bearer {key}")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def detail_of(payload):
    try:
        detail = json.loads(payload).get("detail")
    except json.JSONDecodeError:
        return payload[:120]
    if isinstance(detail, list):
        return str(detail[0].get("msg", ""))[:120]
    return str(detail)[:120]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get(
        "STUDIO_BASE_URL", "http://127.0.0.1:18080"))
    parser.add_argument("--api-key", default=os.environ.get("STUDIO_API_KEY", ""))
    args = parser.parse_args()
    if not args.api_key:
        parser.error("Set STUDIO_API_KEY or pass --api-key")
    base = args.base_url.rstrip("/") + "/api/v1"

    report = {"base_url": args.base_url, "cases": [], "reads": {}}
    for name, payload, expected_status, fragment in CASES:
        key = "invalid-token-value" if name == "invalid token" else args.api_key
        status, text = call(base, key, "POST", "/jobs", payload)
        detail = detail_of(text)
        passed = status == expected_status and (fragment is None or fragment in detail)
        report["cases"].append({
            "case": name, "status": status, "expected": expected_status,
            "detail": detail, "passed": passed,
        })

    for path in ("/system/health", "/system/capabilities", "/models"):
        status, text = call(base, args.api_key, "GET", path)
        entry = {"status": status}
        if path == "/system/capabilities" and status == 200:
            entry["prompt_composition"] = json.loads(text).get("prompt_composition")
        if path == "/models" and status == 200:
            models = json.loads(text)
            entry["models"] = len(models)
            entry["execution_enabled"] = sum(1 for m in models if m["execution_enabled"])
        report["reads"][path] = entry

    status, text = call(base, args.api_key, "GET", "/jobs?limit=1")
    if status == 200:
        jobs = json.loads(text)
        report["reads"]["/jobs"] = {
            "status": status,
            "newest_has_composition": bool(jobs and jobs[0].get("prompt_composition")),
        }

    report["all_rejections_passed"] = all(case["passed"] for case in report["cases"])
    print(json.dumps(report, indent=2, ensure_ascii=False))
    raise SystemExit(0 if report["all_rejections_passed"] else 1)


if __name__ == "__main__":
    main()

