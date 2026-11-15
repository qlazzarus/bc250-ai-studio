"""Exercise the deployer's shared-runtime handling without touching services."""

import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("shared", [True, False])
def test_shared_gate_runtime_is_detected_from_unit_state(tmp_path, shared):
    script = (ROOT / "deploy/deploy-release.sh").read_text()
    guard = script.split("gate_runtime=$(systemctl show", 1)[1].split("sync_needed=false", 1)[0]
    app = tmp_path / "installed"
    app.mkdir()
    result = subprocess.run(
        ["bash", "-c", 'systemctl() { echo "$gate_description"; }\n'
         + "app=" + str(app) + "\n"
         + "gate_runtime=$(systemctl show" + guard
         + 'echo "shared=$shared_gate_runtime"'],
        env={**os.environ,
             "gate_description": str(app) if shared else "/opt/separate-gate"},
        text=True, capture_output=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert f"shared={str(shared).lower()}" in result.stdout


def test_shared_runtime_warns_instead_of_resyncing(tmp_path):
    """A shared virtualenv is never resynced under a running gate."""
    script = (ROOT / "deploy/deploy-release.sh").read_text()
    block = script.split('if [[ "$sync_needed" == true ]]; then', 1)[1].split("systemctl start", 1)[0]
    result = subprocess.run(
        ["bash", "-c", "set -euo pipefail\nsync_needed=true\nshared_gate_runtime=true\napp=" + str(tmp_path)
         + "\nuv() { echo UV_SYNC_RAN; }\n" + 'if [[ "$sync_needed" == true ]]; then' + block],
        text=True, capture_output=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "UV_SYNC_RAN" not in result.stdout
    assert "restart the gate" in result.stderr