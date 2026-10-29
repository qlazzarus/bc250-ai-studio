"""Exercise the candidate with fake commands; never contact a real service."""

import os
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def candidate(tmp_path):
    base = tmp_path / "config"
    models = base / "models"
    models.mkdir(parents=True)
    (base / "active-model.conf").write_text("ACTIVE_MODEL=old\n")
    for name in ("old", "new"):
        model = tmp_path / f"{name}.gguf"
        model.write_bytes(b"model")
        (models / f"{name}.conf").write_text(f"MODEL_PATH={model}\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    commands = {
        "systemctl": """#!/bin/bash
if [[ $1 == restart ]]; then
  name=$(sed -n 's/^ACTIVE_MODEL=//p' "$TEST_BASE/active-model.conf")
  echo "$name" >> "$TEST_BASE/restarts"
  [[ ",$FAIL_RESTART," != *,"$name",* ]]
elif [[ $1 == is-active ]]; then
  echo active
fi
""",
        "curl": """#!/bin/bash
name=$(sed -n 's/^ACTIVE_MODEL=//p' "$TEST_BASE/active-model.conf")
if [[ ",$FAIL_HEALTH," == *,"$name",* ]]; then exit 1; fi
echo '{"status": "ok"}'
""",
        "seq": "#!/bin/bash\necho 1\n",
        "sleep": "#!/bin/bash\nexit 0\n",
    }
    for name, contents in commands.items():
        path = bin_dir / name
        path.write_text(contents)
        path.chmod(0o755)
    source = Path(__file__).resolve().parents[2] / "deploy/ai-model-recovery-candidate"
    script = tmp_path / "candidate"
    script.write_text(source.read_text().replace("BASE=/opt/ai/config", f"BASE={base}"))
    script.chmod(0o755)
    env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}", TEST_BASE=str(base))

    def run(fail_restart="", fail_health="", model="new"):
        return subprocess.run(
            [str(script), "switch", model],
            env=dict(env, FAIL_RESTART=fail_restart, FAIL_HEALTH=fail_health),
            capture_output=True, text=True, check=False,
        )

    return base, run


@pytest.mark.parametrize("restart,health", [("new", ""), ("", "new")])
def test_switch_failure_verifies_previous_model(candidate, restart, health):
    base, run = candidate
    result = run(fail_restart=restart, fail_health=health)
    assert result.returncode == 1
    assert (base / "active-model.conf").read_text() == "ACTIVE_MODEL=old\n"
    assert (base / "restarts").read_text().splitlines() == ["new", "old"]
    assert "restored and healthy" in result.stderr


@pytest.mark.parametrize("restart,health", [("new,old", ""), ("new", "old")])
def test_failed_recovery_is_distinct(candidate, restart, health):
    base, run = candidate
    result = run(fail_restart=restart, fail_health=health)
    assert result.returncode == 3
    assert "RECOVERY_REQUIRED" in result.stderr
    assert (base / "active-model.conf").read_text() == "ACTIVE_MODEL=old\n"


def test_invalid_name_never_restarts(candidate):
    base, run = candidate
    assert run(model="../old").returncode == 2
    assert not (base / "restarts").exists()


def test_switch_success(candidate):
    base, run = candidate
    assert run().returncode == 0
    assert (base / "active-model.conf").read_text() == "ACTIVE_MODEL=new\n"
