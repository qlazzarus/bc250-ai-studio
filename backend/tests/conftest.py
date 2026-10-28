import time

import pytest
from app.core.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient

CLIENT_KEY = "client-key-for-tests-1234567890"
ADMIN_KEY = "admin-key-for-tests-1234567890"
HEADERS = {"Authorization": f"Bearer {CLIENT_KEY}"}
ADMIN = {"Authorization": f"Bearer {ADMIN_KEY}"}


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
