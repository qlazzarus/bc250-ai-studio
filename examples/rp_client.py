"""Authenticated submit + durable SSE replay example; links jobs to chat message IDs.
STUDIO_API_KEY=... uv run python examples/rp_client.py
"""

import json
import os
import time

import httpx


def main():
    with httpx.Client(
        base_url=os.getenv("STUDIO_URL", "http://127.0.0.1:8090"),
        headers={"Authorization": f"Bearer {os.environ['STUDIO_API_KEY']}"},
        timeout=30,
    ) as client:
        response = client.post(
            "/api/v1/jobs",
            json={
                "model_id": "fake",
                "prompt": "A chicken farm",
                "source": "rp",
                "client_reference": "chat-message-001",
                "seed": 42,
            },
        )
        response.raise_for_status()
        job_id = response.json()["job_id"]
        print("Accepted:", job_id, "(manual mode requires an administrator grant)")
        cursor = 0
        pending_id = 0
        while True:
            try:
                with client.stream(
                    "GET", f"/api/v1/jobs/{job_id}/events", headers={"Last-Event-ID": str(cursor)}
                ) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if line.startswith("id: "):
                            pending_id = int(line[4:])
                        elif line.startswith("data: "):
                            event = json.loads(line[6:])
                            print(event["status"], event["output_asset_ids"])
                            cursor = pending_id  # Advance only after processing the payload.
                            if event["status"] in {
                                "completed",
                                "failed",
                                "cancelled",
                                "interrupted",
                            }:
                                return
                        elif line == ": end":
                            return
            except httpx.TransportError:
                time.sleep(1)  # Replay after last processed event, including completion.


if __name__ == "__main__":
    main()
