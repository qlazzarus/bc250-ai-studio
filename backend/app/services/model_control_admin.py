"""Root-only local recovery client. Never accepts commands, paths or unit names."""

import argparse
import asyncio
import json
import os

from app.services.model_control_bridge import ModelControlClient
from app.services.model_control_runtime import SOCKET


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("models", "pending", "get", "recover", "resolve_verified"))
    parser.add_argument("id", nargs="?")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run as root")
    if (args.operation in {"get", "recover", "resolve_verified"}) != (args.id is not None):
        parser.error("Only get/recover/resolve_verified require an operation ID")
    try:
        result = asyncio.run(ModelControlClient(SOCKET).request(
            args.operation, **({"id": args.id} if args.id else {})))
    except Exception:
        raise SystemExit("Model worker unavailable") from None
    print(json.dumps(result, ensure_ascii=False))
    if "error" in result:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
