#!/usr/bin/env python3
"""Read-only host inventory. No service mutations, model downloads or GPU inference."""

import argparse
import hashlib
import json
import platform
import re
import shutil
import subprocess
from pathlib import Path


def run(args):
    if not shutil.which(args[0]):
        return {"verified": False, "reason": "command not installed", "command": args[0]}
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=20, check=False)
        return {
            "exit_code": result.returncode,
            "stdout": result.stdout[:32000],
            "stderr": result.stderr[:4000],
        }
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"verified": False, "reason": str(error)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sd-cli", default="/opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli")
    parser.add_argument("--model-root", default="/opt/sd-models")
    parser.add_argument("--llm-service", help="Known service name; read-only systemctl show")
    parser.add_argument("--inspect-cli", action="store_true", help="Also execute sd-cli --help")
    args = parser.parse_args()
    if args.llm_service and not re.fullmatch(
        r"[a-zA-Z0-9_][a-zA-Z0-9_.@-]*\.service", args.llm_service
    ):
        parser.error("Invalid systemd unit name")
    cli = Path(args.sd_cli)
    models = Path(args.model_root)
    report = {
        "os": platform.platform(),
        "python": platform.python_version(),
        "disk": dict(
            zip(("total", "used", "free"), shutil.disk_usage(models if models.exists() else "/"))
        ),
        "paths": {
            p: Path(p).exists()
            for p in [args.sd_cli, args.model_root, "/opt/sd-output", "/opt/sd-hf-venv"]
        },
        "vulkan": run(["vulkaninfo", "--summary"]),
        "listeners": run(["ss", "-lntp"]),
        "processes": run(["ps", "-eo", "pid,comm"]),
        "services": run(["systemctl", "list-units", "--all", "--type=service", "--no-pager"]),
        "model_files": [
            {"path": str(p), "bytes": p.stat().st_size}
            for p in sorted(models.rglob("*"))
            if p.is_file() and p.suffix.lower() in {".gguf", ".safetensors", ".ckpt"}
        ],
        "inference_tested": False,
    }
    if cli.is_file():
        with cli.open("rb") as file:
            report["sd_cli_sha256"] = hashlib.file_digest(file, "sha256").hexdigest()
    if args.inspect_cli and cli.is_file():
        report["sd_cli_help"] = run([str(cli), "--help"])
    if args.llm_service:
        report["llm_unit"] = run(
            [
                "systemctl",
                "show",
                args.llm_service,
                "--no-pager",
                "--property=Id,LoadState,ActiveState,SubState,MainPID,FragmentPath,ControlGroup,KillMode",
            ]
        )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
