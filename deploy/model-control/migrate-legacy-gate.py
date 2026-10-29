#!/usr/bin/env python3
"""Capture legacy pause ownership and create first owned-gate state, manually only."""

import argparse
import json
import os
import pwd
import shlex
import stat
import subprocess
import urllib.request
from pathlib import Path

OLD_ENV = Path("/etc/bc250-llm-gate.env")
SNAPSHOT = Path("/var/lib/bc250-model-control/legacy-pause.json")
GATE_DIR = Path("/var/lib/bc250-llm-gate")
URL = "http://127.0.0.1:8081/control"


def validate_root_path(path, *, directory):
    for item in (path, *path.parents):
        info = item.lstat()
        if (info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode)
                or (item == path and directory and not stat.S_ISDIR(info.st_mode))
                or (item == path and not directory and not stat.S_ISREG(info.st_mode))):
            raise RuntimeError("Untrusted migration path")


def legacy_key(path=OLD_ENV):
    keys = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("GATE_API_KEY="):
            continue
        values = shlex.split(line.partition("=")[2], comments=True)
        if len(values) != 1:
            raise RuntimeError("Unsupported legacy gate key syntax")
        keys.append(values[0])
    if len(keys) != 1 or len(keys[0]) < 24:
        raise RuntimeError("Cannot identify the legacy gate credential")
    return keys[0]


def request(key, method, payload=None):
    headers = {"Authorization": "Bearer " + key}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    req = urllib.request.Request(URL, data=data, headers=headers, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=10) as response:
        result = json.load(response)
    if (not isinstance(result, dict) or type(result.get("paused")) is not bool
            or type(result.get("active_requests")) is not int
            or type(result.get("waiting_requests")) is not int):
        raise RuntimeError("Invalid legacy gate status")
    return result


def save_once(path, value, mode=0o600, owner=None):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        if owner is not None:
            os.fchown(fd, owner.pw_uid, owner.pw_gid)
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            fd = -1
            json.dump(value, file)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
    finally:
        if fd != -1:
            os.close(fd)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def read_snapshot(path=SNAPSHOT):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or info.st_mode & 0o077):
            raise RuntimeError("Untrusted migration record")
        raw = os.read(fd, 1025)
    finally:
        os.close(fd)
    value = json.loads(raw)
    if len(raw) > 1024 or set(value) != {"paused_before_maintenance"} or type(
        value["paused_before_maintenance"]
    ) is not bool:
        raise RuntimeError("Invalid migration record")
    return value


def capture(key, snapshot=SNAPSHOT):
    state = request(key, "GET")
    if "protocol" in state:
        raise RuntimeError("Gate is not the legacy control protocol")
    save_once(snapshot, {"paused_before_maintenance": state["paused"]})
    return pause(key, snapshot)


def pause(key, snapshot=SNAPSHOT):
    read_snapshot(snapshot)
    state = request(key, "PUT", {"paused": True})
    if not state["paused"]:
        raise RuntimeError("Legacy gate did not pause")
    return state


def verify_stopped(unit):
    output = subprocess.run(
        ["/usr/bin/systemctl", "show", "--all",
         "--property=LoadState,ActiveState,MainPID,Job,KillMode", unit],
        check=True, capture_output=True, text=True, timeout=10,
    ).stdout
    properties = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
    if (properties.get("LoadState") != "loaded" or properties.get("ActiveState") != "inactive"
            or properties.get("MainPID") != "0" or properties.get("Job") != ""
            or properties.get("KillMode") != "control-group"):
        raise RuntimeError("Studio and legacy gate must be fully stopped")


def create_state(snapshot=SNAPSHOT, gate_dir=GATE_DIR):
    state = read_snapshot(snapshot)
    verify_stopped("bc250-ai-studio.service")
    verify_stopped("bc250-llm-gate.service")
    owner = pwd.getpwnam("ai-gate")
    gate_dir.mkdir(mode=0o700)  # Never reuse or erase a pre-existing state directory.
    os.chown(gate_dir, owner.pw_uid, owner.pw_gid)
    holds = ["legacy"] if state["paused_before_maintenance"] else []
    save_once(gate_dir / "holds.json", {"holds": holds}, owner=owner)
    parent = os.open(gate_dir.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("capture", "pause", "create-state"))
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run as root")
    os.umask(0o077)
    try:
        validate_root_path(SNAPSHOT.parent, directory=True)
        if args.operation == "create-state":
            create_state()
            print("Gate state created; prior administrator pause preserved.")
        else:
            validate_root_path(OLD_ENV, directory=False)
            result = (capture if args.operation == "capture" else pause)(legacy_key())
            print("Legacy gate paused; active requests:", result["active_requests"])
    except Exception:
        raise SystemExit("Migration step failed; preserve existing state and inspect the procedure") from None


if __name__ == "__main__":
    main()
