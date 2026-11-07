"""Exercise the actual pre-stop shared-runtime guard without touching services."""

import hashlib
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_release_keeps_current_gate_runtime_unchanged():
    expected = {
        "backend/app/gate.py": "d59130064db202ee254c5cc5813913ef56f505af9df0e23fe4243cf8bfbd0365",
        "backend/app/core/config.py": "f00b89ce21320da093bb85fc160f421eac61b6043a4782e6c6010292d86853d3",
        "backend/app/core/files.py": "c621c8bb17f35817d64cee70adbd957813e3a902de47d7b9448f09c317c57a0e",
    }
    for name, digest in expected.items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest, name


@pytest.mark.parametrize("shared,changed,success", [
    (True, False, True), (True, True, False), (False, True, True),
])
def test_shared_gate_runtime_guard(tmp_path, shared, changed, success):
    script = (ROOT / "deploy/deploy-release.sh").read_text()
    guard = script.split("gate_runtime=", 1)[1].split(
        "# systemd shutdown waits", 1)[0]
    app, stage = tmp_path / "installed", tmp_path / "release"
    python = app / ".venv/bin/python"
    python.parent.mkdir(parents=True)
    python.write_text(f'#!/bin/sh\nexec "{sys.executable}" "$@"\n')
    python.chmod(0o755)
    for item in ("pyproject.toml", "uv.lock", "backend/app/__init__.py",
                 "backend/app/gate.py", "backend/app/core/__init__.py",
                 "backend/app/core/config.py", "backend/app/core/files.py"):
        for root in (app, stage):
            path = root / item
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("same")
    if changed:
        (stage / "backend/app/gate.py").write_text("changed")
    result = subprocess.run(
        ["bash", "-c", 'set -euo pipefail\nsystemctl() { echo "$gate_description"; }\n'
         + "gate_runtime=" + guard + '\necho SAFE_TO_STOP'],
        env={**os.environ, "app": str(app), "stage": str(stage),
             "gate_description": str(app) if shared else "/opt/separate-gate"},
        text=True, capture_output=True, check=False,
    )
    assert (result.returncode == 0) == success
    assert ("SAFE_TO_STOP" in result.stdout) == success
