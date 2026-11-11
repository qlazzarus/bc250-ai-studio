import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("changed", [False, True])
def test_model_control_static_release_guard(tmp_path, changed):
    script = (ROOT / "deploy/deploy-release.sh").read_text()
    branch = script.split('if [[ "$model_control" == true ]]; then', 1)[1].split(
        '# Keep a rollback copy', 1)[0]
    app, stage = tmp_path / "installed", tmp_path / "release"
    for root in (app, stage):
        (root / "backend").mkdir(parents=True)
        (root / "config").mkdir()
        for item in ("pyproject.toml", "uv.lock", "config/models.yaml", "backend/main.py"):
            (root / item).write_text("same")
    if changed:
        (stage / "backend/main.py").write_text("changed")
    result = subprocess.run(
        ["bash", "-c", "set -euo pipefail\n" + branch + '\necho SAFE_TO_INSTALL'],
        env={**os.environ, "app": str(app), "stage": str(stage)},
        text=True, capture_output=True, check=False,
    )
    assert (result.returncode == 0) is not changed
    assert ("SAFE_TO_INSTALL" in result.stdout) is not changed

