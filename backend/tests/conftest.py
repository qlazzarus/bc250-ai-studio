import time

import httpx
import pytest
from app.core.studio_config import Settings
from app.main import create_app
from fastapi.testclient import TestClient

CLIENT_KEY = "client-key-for-tests-1234567890"
ADMIN_KEY = "admin-key-for-tests-1234567890"
HEADERS = {"Authorization": f"Bearer {CLIENT_KEY}"}
ADMIN = {"Authorization": f"Bearer {ADMIN_KEY}"}

# LLM-I03: any transport that fakes the gate must also answer /model-snapshot,
# because every inference call now reads the epoch first. The value is a fixed
# 32-hex string shaped like the gate's own `secrets.token_hex(16)`.
SNAPSHOT_EPOCH = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"


def snapshot(model, *, epoch=SNAPSHOT_EPOCH, ready=True, status=200):
    """The gate's /model-snapshot body, in the shape measured on the host.

    ``models`` is the proxied llama ``/v1/models`` reply, so a test that changes the
    served model changes the id here rather than inventing a second contract.
    """
    if status != 200:
        return httpx.Response(status, json={"detail": "model_epoch_mismatch"})
    return httpx.Response(status, json={
        "ready": ready,
        "epoch": epoch,
        "models": {"object": "list", "data": [{"id": model, "object": "model"}]}
            if model else {"object": "list", "data": []},
    })



@pytest.fixture
def settings(tmp_path):
    return Settings(
        data_dir=tmp_path / "data",
        api_key=CLIENT_KEY,
        admin_key=ADMIN_KEY,
        policy="image_priority",
        poll_interval=0.01,
        fake_delay=0.01,
    )


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        client.headers.update(HEADERS)
        yield client


def submit(client, **changes):
    response = client.post(
        "/api/v1/jobs", json=dict(model_id="fake", prompt="A blue chicken", **changes)
    )
    assert response.status_code == 202, response.text
    return response.json()["job_id"]


def wait_job(client, job_id, states=None):
    states = states or {"completed", "failed", "cancelled", "interrupted"}
    end = time.monotonic() + 5
    while time.monotonic() < end:
        response = client.get(f"/api/v1/jobs/{job_id}")
        assert response.status_code == 200
        if response.json()["status"] in states:
            return response.json()
        time.sleep(0.01)
    raise AssertionError(response.json())
