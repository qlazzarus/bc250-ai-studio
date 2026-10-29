#!/usr/bin/env python3
"""Provision the new root-owned state directory without replacing existing data."""

import grp
import os
from pathlib import Path

DIRECTORY = Path("/var/lib/bc250-model-control")


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run as root")
    group = grp.getgrnam("ai-studio").gr_gid
    os.umask(0o077)
    try:
        DIRECTORY.mkdir(mode=0o750)
    except FileExistsError:
        raise SystemExit("State directory already exists; preserve its recovery records") from None
    os.chown(DIRECTORY, 0, group)
    os.chmod(DIRECTORY, 0o750)
    fd = os.open(DIRECTORY / "switch.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    with os.fdopen(fd, "w") as file:
        os.fchown(file.fileno(), 0, group)
        os.fchmod(file.fileno(), 0o640)
        file.write("{}\n")
        file.flush()
        os.fsync(file.fileno())
    for path in (DIRECTORY, DIRECTORY.parent):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    print("Empty model-switch state created; no service was changed.")


if __name__ == "__main__":
    main()
