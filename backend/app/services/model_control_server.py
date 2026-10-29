"""Read-only systemd socket-activated model control worker.

This worker cannot switch models. systemd supplies one connected Unix socket on
stdin; neither request content nor environment selects the allowed account or
registry path.
"""

import pwd
import socket
import sys

from app.services.model_control import ModelRegistry, serve_connection


def main():
    uid = pwd.getpwnam("ai-studio").pw_uid
    with socket.fromfd(sys.stdin.fileno(), socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        serve_connection(connection, uid, ModelRegistry())


if __name__ == "__main__":
    main()
