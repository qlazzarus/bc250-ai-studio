#!/usr/bin/env python3
"""Repeat a compose request and record what the server actually reported (UCP09 follow-up).

Why this is separate from the pytest suites: every one of those stubs the provider, so none
of them can say what the real BC-250 answers. This script sends the *same* input repeatedly
and records, per call, the fields that tell the failure modes apart:

* candidate count, and the drop reasons the server logs (never the candidate text);
* ``finish_reason``, ``output_tokens``, ``latency_ms`` from the provider block;
* host RAM/Swap and GPU VRAM/GTT around each call, so a memory story can be confirmed or
  ruled out instead of assumed.

It does not generate images. Compose only, per the follow-up scope.

    STUDIO_API_KEY=... STUDIO_BASE_URL=http://127.0.0.1:18080 \
        uv run python scripts/ucp09/probe-compose-candidates.py \
            --brief-file /tmp/failing-brief.txt --repeat 5 --out docs/evidence/ucp09-followup

The brief is hashed, never written to the evidence file: the report is about counts and
provider numbers, and the journal already holds the diagnostic without any input text.
Resource sampling needs the BC-250 host, so it goes over SSH exactly as
``inspect-bc250.sh`` does; ``--no-resources`` skips it and the HTTP checks still run.

Exit codes: 0 = every call ran, 2 = environment refused (nothing measured), 3 = a call
returned something the contract does not allow. Nothing is retried.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app.models.schemas import ComposeSelection  # noqa: E402
from app.services.prompt_compose import compose_revisions  # noqa: E402

# One command, read-only: /proc/meminfo and the amdgpu sysfs counters. No sudo, no writes.
RESOURCE_COMMAND = r"""
awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ {printf "mem.%s=%s\n", $1, $2}' /proc/meminfo
for f in /sys/class/drm/card*/device/mem_info_vram_used \
         /sys/class/drm/card*/device/mem_info_gtt_used; do
    [ -r "$f" ] && printf "gpu.%s=%s\n" "$(basename "$f")" "$(cat "$f")"
done
exit 0
"""


def request_id():
    # `cmp-` + 12 hex is the schema's only accepted shape.
    return "cmp-" + uuid.uuid4().hex[:12]


def call(base, key, method, path, body=None, timeout=90):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = urllib.request.Request(f"{base.rstrip('/')}{path}", data=data, method=method)
    request.add_header("Authorization", f"Bearer {key}")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return {"status": response.status,
                    "wall_ms": int((time.monotonic() - started) * 1000),
                    "body": json.loads(raw) if raw else {}}
    except urllib.error.HTTPError as error:
        return {"status": error.code,
                "wall_ms": int((time.monotonic() - started) * 1000),
                "body": error.read().decode("utf-8", "replace")[:2000]}
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        return {"status": None, "wall_ms": int((time.monotonic() - started) * 1000),
                "error": f"{type(error).__name__}: {error}"}


def ssh_command(args):
    return ["ssh", "-i", args.key, "-p", str(args.port),
            "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.ssh]


def resources(args):
    """Host memory and GPU counters, or an explanation of why they are missing."""
    if args.no_resources:
        return {"skipped": "no_resources"}
    try:
        result = subprocess.run(ssh_command(args) + ["bash -s"], input=RESOURCE_COMMAND,
                                text=True, capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as error:
        return {"unreadable": f"{type(error).__name__}: {error}"}
    if result.returncode != 0:
        return {"unreadable": (result.stderr or "ssh failed").strip()[:300]}
    values = {}
    for line in result.stdout.splitlines():
        name, _, value = line.partition("=")
        if name and value:
            values[name.strip()] = value.strip()
    return values




def journal(args, since):
    """The diagnostic lines the server wrote for these calls, if this account may read them."""
    pattern = "compose (no_valid_candidates|candidates_dropped)"
    command = (f"journalctl -u bc250-ai-studio --since '{since}' --no-pager "
               f"-g '{pattern}' -o cat 2>&1 | tail -40")
    try:
        result = subprocess.run(ssh_command(args) + [command], text=True,
                                capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as error:
        return {"unreadable": f"{type(error).__name__}: {error}"}
    text = (result.stdout or "").strip()
    # journalctl says this when the account is not in systemd-journal. That is a finding,
    # not a failure: the procedure records it rather than escalating to sudo.
    if "not seeing messages" in text or "No journal files" in text:
        return {"unreadable": text[:300]}
    return {"lines": [line for line in text.splitlines() if line][:40]}


def summarize(body):
    """The fields that separate "no candidates" from "some dropped" from "all rejected"."""
    if not isinstance(body, dict):
        return {"shape": "not_a_json_object"}
    provider = body.get("provider") or {}
    scene = body.get("scene") or {}
    return {
        "status": body.get("status"),
        "detail": body.get("detail"),
        "why": body.get("why"),
        "candidates": len(body.get("candidates") or []),
        "clarifications": len(body.get("clarifications") or []),
        "warnings": body.get("warnings") or [],
        "cut_short": body.get("cut_short"),
        "finish_reason": provider.get("finish_reason"),
        "output_tokens": provider.get("output_tokens"),
        "prompt_tokens": provider.get("prompt_tokens"),
        "latency_ms": provider.get("latency_ms"),
        "scene_present": bool(scene.get("entities") or scene.get("environment")),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=os.environ.get("STUDIO_BASE_URL",
                                                         "http://127.0.0.1:18080"))
    parser.add_argument("--api-key", default=os.environ.get("STUDIO_API_KEY", ""))
    parser.add_argument("--brief-file", required=True,
                        help="UTF-8 file holding the Korean brief to repeat")
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--model", default="z-image-nsfw-v2")
    parser.add_argument("--family", default="z-image")
    parser.add_argument("--selections", default="",
                        help="comma-separated dictionary IDs sent as manual chips")
    parser.add_argument("--out", default="docs/evidence/ucp09-followup")
    parser.add_argument("--ssh", default=os.environ.get(
        "UCP09_SSH", "yeppyshiba@yeppyshiba.iptime.org"))
    parser.add_argument("--port", default=os.environ.get("UCP09_PORT", "2222"))
    parser.add_argument("--key", default=os.environ.get(
        "UCP09_KEY", str(Path.home() / ".ssh/bc250_studio_maintenance")))
    parser.add_argument("--no-resources", action="store_true")
    args = parser.parse_args()
    if not args.api_key:
        parser.error("Set STUDIO_API_KEY or pass --api-key")
    brief = Path(args.brief_file).read_text(encoding="utf-8").strip()
    if not brief:
        parser.error("--brief-file is empty")

    capabilities = call(args.base, args.api_key, "GET", "/api/v1/system/capabilities")
    if capabilities.get("status") != 200:
        print(json.dumps({"refused": "capabilities", "detail": capabilities}, indent=2))
        raise SystemExit(2)
    compose = capabilities["body"].get("prompt_compose")
    if not compose:
        # The one precondition that makes every call below pointless.
        print(json.dumps({"refused": "prompt_compose_not_advertised"}, indent=2))
        raise SystemExit(2)
    profile_version = (compose.get("output_profile_versions") or {}).get(args.family)
    if not profile_version:
        print(json.dumps({"refused": "no_profile_for_family", "family": args.family},
                         indent=2))
        raise SystemExit(2)

    ids = [item.strip() for item in args.selections.split(",") if item.strip()]
    selections = [ComposeSelection(id=item, source="manual", pinned=True) for item in ids]
    revision = compose_revisions(
        brief_ko=brief, selections=selections, choices=[],
        target_model_id=args.model, target_family=args.family,
        profile_version=profile_version,
        dictionary_version=compose["dictionary_version"])["input"]

    report = {
        "base": args.base, "model": args.model, "family": args.family,
        "profile_version": profile_version,
        "dictionary_version": compose["dictionary_version"],
        # The brief itself is not evidence about the bug; its identity is enough to say
        # which input was repeated.
        "brief_sha256": hashlib.sha256(brief.encode("utf-8")).hexdigest(),
        "brief_chars": len(brief), "repeat": args.repeat, "calls": [],
    }
    started_at = time.strftime("%Y-%m-%d %H:%M:%S")
    for index in range(args.repeat):
        before = resources(args)
        payload = {
            "schema_version": 1, "request_id": request_id(), "input_revision": revision,
            "dictionary_version": compose["dictionary_version"],
            "target_model_id": args.model, "target_family": args.family,
            "profile_version": profile_version, "candidate_count": 3,
            "brief_ko": brief,
            "selections": [{"id": item, "source": "manual", "pinned": True}
                           for item in ids],
            "clarification_choices": [],
        }
        result = call(args.base, args.api_key, "POST", "/api/v1/prompt/compose", payload)
        after = resources(args)
        report["calls"].append({
            "call": index + 1, "http_status": result.get("status"),
            "wall_ms": result.get("wall_ms"), **summarize(result.get("body")),
            "resources_before": before, "resources_after": after,
        })
        # Printed as it happens: a slow call should not look like a hang.
        print(f"call {index + 1}/{args.repeat}: {json.dumps(report['calls'][-1])}",
              flush=True)

    report["journal"] = journal(args, started_at)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"compose-candidates-{time.strftime('%Y%m%d-%H%M%S')}.json"
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {target}")

    broken = [item for item in report["calls"]
              if item["http_status"] not in (200, 503) or "error" in item]
    raise SystemExit(3 if broken else 0)


if __name__ == "__main__":
    main()

