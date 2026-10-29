#!/usr/bin/env python3
"""Create new, distinct credentials and opt-in environment files without printing keys.

This is a one-time staging tool. It never updates an existing installation, changes
units, creates gate state, or starts services.
"""

import os
import secrets
from pathlib import Path

DIRECTORY = Path("/etc/bc250-model-control")


def write(name, content):
    path = DIRECTORY / name
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as file:
        file.write(content)
        file.flush()
        os.fsync(file.fileno())


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run as root")
    os.umask(0o077)
    try:
        DIRECTORY.mkdir(mode=0o700)
    except FileExistsError:
        raise SystemExit("Configuration directory already exists; do not overwrite it") from None
    generated = set()
    while len(generated) < 5:
        generated.add(secrets.token_hex(32))
    admin, studio, switch, api, coordination = generated
    write("gate-admin-key", admin + "\n")
    write("studio-gate-key", studio + "\n")
    write("switch-gate-key", switch + "\n")
    write("api-key", api + "\n")
    write("studio-coordination-key", coordination + "\n")
    # Empty only if llama-server requires no API key. Set securely before activation if needed.
    write("llm-key", "")
    write("worker.env", "MODEL_CONTROL_SWITCH_ENABLED=false\n")
    write("gate.env", "\n".join([
        "GATE_OWNED_CONTROL=true", "GATE_STATE_PATH=/var/lib/bc250-llm-gate/holds.json",
        "GATE_API_KEY=" + admin, "GATE_STUDIO_KEY=" + studio,
        "GATE_SWITCH_KEY=" + switch, "",
    ]))
    write("studio-gate.env", "\n".join([
        "STUDIO_GPU_LOCK_PATH=/run/bc250-gpu/gpu.lock",
        "STUDIO_GPU_LOCK_SECURE_PRECREATED=true",
        "STUDIO_SWITCH_JOURNAL_PATH=/var/lib/bc250-model-control/switch.json",
        "STUDIO_ADMISSION_OWNED_HOLDS=true",
        "STUDIO_ADMISSION_URL=http://127.0.0.1:8081/control",
        "STUDIO_ADMISSION_KEY=" + studio,
        "STUDIO_COORDINATION_KEY=" + coordination, "",
    ]))
    directory = os.open(DIRECTORY, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    print("Configuration created with distinct credentials; no service was changed.")


if __name__ == "__main__":
    main()
