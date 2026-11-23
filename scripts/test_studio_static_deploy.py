"""Check the guards the fast deployer keeps for a single-operator host."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "deploy/deploy-release.sh").read_text()
PACKER = ROOT / "scripts/package-release.py"


def test_release_archive_is_byte_reproducible(tmp_path):
    """The same staged tree must hash the same, or a pinned hash never matches."""
    stage, other = tmp_path / "stage", tmp_path / "other"
    for root in (stage, other):
        (root / "backend/app").mkdir(parents=True, exist_ok=True)
        (root / "config").mkdir(parents=True, exist_ok=True)
        (root / "frontend/dist").mkdir(parents=True, exist_ok=True)
        (root / "pyproject.toml").write_text("project")
        (root / "uv.lock").write_text("lock")
        (root / "config/models.yaml").write_text("models")
        (root / "backend/app/main.py").write_text("app")
        (root / "frontend/dist/index.html").write_text("built")
    first, second = tmp_path / "a.tar.gz", tmp_path / "b.tar.gz"
    for root, output in ((stage, first), (other, second)):
        result = subprocess.run(
            [sys.executable, str(PACKER), str(root), str(output)],
            text=True, capture_output=True, check=False,
        )
        assert result.returncode == 0, result.stderr
        os.utime(root / "backend/app/main.py", (1, 1))
    assert first.read_bytes() == second.read_bytes()


def test_release_archive_rejects_a_missing_item(tmp_path):
    (tmp_path / "pyproject.toml").write_text("project")
    result = subprocess.run(
        [sys.executable, str(PACKER), str(tmp_path), str(tmp_path / "out.tar.gz")],
        text=True, capture_output=True, check=False,
    )
    assert result.returncode != 0
    assert "Missing release item" in result.stderr


def bash(snippet, env=None):
    return subprocess.run(
        ["bash", "-c", "set -euo pipefail\n" + snippet + "\necho SAFE_TO_INSTALL"],
        env={**os.environ, **(env or {})},
        text=True, capture_output=True, check=False,
    )


def release_tree(tmp_path, backend="changed", frontend="built"):
    app, stage = tmp_path / "installed", tmp_path / "release"
    for root, backend_body, frontend_body in (
        (app, "old", "old"), (stage, backend, frontend),
    ):
        for item in ("pyproject.toml", "uv.lock"):
            (root).mkdir(parents=True, exist_ok=True)
            (root / item).write_text("same")
        # `config` is a directory the deployer replaces wholesale, so its files
        # must be nested: a flat `config` file would make `rm -rf config/*` fail.
        (root / "config").mkdir(parents=True, exist_ok=True)
        (root / "config/models.yaml").write_text("same")
        # The dictionary is required by the release precondition and by
        # `prompt_proposals`/`prompt_compose`; without it the server degrades.
        (root / "config/prompt_dictionary.json").write_text('{"entries": []}')
        (root / "backend").mkdir(parents=True, exist_ok=True)
        (root / "backend/main.py").write_text(backend_body)
        (root / "frontend/dist").mkdir(parents=True, exist_ok=True)
        (root / "frontend/dist/index.html").write_text(frontend_body)
    return app, stage


def deploy_items():
    """The items the deployer copies, read from the script itself.

    Parsing avoids a second copy of the list in this test: when the list gained
    `config/prompt_dictionary.json` the hard-coded string silently stopped
    matching and the test failed with IndexError instead of checking anything.
    """
    line = next(row for row in SCRIPT.splitlines() if row.startswith("for item in "))
    return line.removeprefix("for item in ").removesuffix("; do").split()


def test_backend_and_frontend_are_replaced_together(tmp_path):
    """A backend change is deployed instead of being refused or dropped."""
    app, stage = release_tree(tmp_path)
    body = SCRIPT.split("for item in backend", 1)[1].split("done", 1)[0]
    result = bash(
        f"app={app}\nstage={stage}\n"
        "for item in " + " ".join(deploy_items()) + body + "done"
    )
    assert result.returncode == 0, result.stderr
    assert (app / "backend/main.py").read_text() == "changed"
    assert (app / "frontend/dist/index.html").read_text() == "built"


def test_config_directory_is_shipped_with_the_dictionary(tmp_path):
    """The prompt dictionary must reach the host, or compose is never advertised.

    Copying only `config/models.yaml` left `config/prompt_dictionary.json`
    behind, and a missing mirror is reported as "not configured" rather than as
    an error, so `prompt_proposals`/`prompt_compose` disappeared silently.
    """
    app, stage = release_tree(tmp_path)
    items = deploy_items()
    assert "config" in items or "config/prompt_dictionary.json" in items, (
        f"the deployer copies {items}, which cannot carry the prompt dictionary"
    )
    body = SCRIPT.split("for item in backend", 1)[1].split("done", 1)[0]
    result = bash(
        f"app={app}\nstage={stage}\n"
        "for item in " + " ".join(items) + body + "done"
    )
    assert result.returncode == 0, result.stderr
    assert (app / "config/prompt_dictionary.json").is_file()
    assert (app / "config/models.yaml").read_text() == "same"


@pytest.mark.parametrize("payload,allowed", [(r'{"id": "abc"}', False), ("{}", True)])
def test_unresolved_switch_journal_stops_the_release(tmp_path, payload, allowed):
    journal = tmp_path / "switch.json"
    journal.write_text(payload + "\n")
    body = SCRIPT.split("journal=/var/lib/bc250-model-control/switch.json", 1)[1].split(
        "backup=$(mktemp", 1)[0]
    result = bash("journal=" + str(journal) + body)
    assert (result.returncode == 0) is allowed, result.stderr
    assert ("SAFE_TO_INSTALL" in result.stdout) is allowed


@pytest.mark.parametrize("lock_changed", [False, True])
def test_dependency_sync_is_requested_only_for_changed_lock(tmp_path, lock_changed):
    backup, stage = tmp_path / "installed", tmp_path / "release"
    for root in (backup, stage):
        root.mkdir(parents=True, exist_ok=True)
        (root / "pyproject.toml").write_text("same")
        (root / "uv.lock").write_text("same")
    if lock_changed:
        (stage / "uv.lock").write_text("changed")
    body = SCRIPT.split("sync_needed=false", 1)[1].split("for item in backend", 1)[0]
    result = bash(
        f"backup={backup}\nstage={stage}\napp={tmp_path}\n"
        "shared_gate_runtime=false\n"
        "sync_needed=false" + body
        + 'if [[ "$sync_needed" == true ]]; then echo SYNC; fi'
    )
    assert result.returncode == 0, result.stderr
    assert ("SYNC" in result.stdout) is lock_changed


@pytest.mark.parametrize("shared,expects_uv", [(True, False), (False, True)])
def test_sync_runs_only_when_no_gate_shares_the_virtualenv(tmp_path, shared, expects_uv):
    (tmp_path / ".venv").mkdir()
    body = SCRIPT.split('if [[ "$sync_needed" == true ]]; then', 1)[1].split(
        "systemctl start", 1)[0]
    result = bash(
        f"app={tmp_path}\nsync_needed=true\n"
        f"shared_gate_runtime={'true' if shared else 'false'}\n"
        'uv() { echo UV_SYNC_RAN; }\n'
        'if [[ "$sync_needed" == true ]]; then' + body
    )
    assert result.returncode == 0, result.stderr
    assert ("UV_SYNC_RAN" in result.stdout) is expects_uv