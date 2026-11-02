"""Verify the live LLM client uses the owned gate administrator credential."""

import argparse
import hmac
import os
import re
from pathlib import Path

from app.services.gate_admin import check_gate_identity, read_key, service_ready

MAX_ENVIRONMENT = 131072


def process_gate_key(pid):
    if not isinstance(pid, str) or not pid.isdigit() or int(pid) <= 1:
        raise RuntimeError("Invalid client process")
    fd = os.open(Path("/proc") / pid / "environ", os.O_RDONLY | os.O_CLOEXEC)
    with os.fdopen(fd, "rb") as stream:
        data = stream.read(MAX_ENVIRONMENT + 1)
    if len(data) > MAX_ENVIRONMENT:
        raise RuntimeError("Client environment exceeds size limit")
    prefix = b"LLM_GATE_API_KEY="
    values = [item[len(prefix):] for item in data.split(b"\0") if item.startswith(prefix)]
    if len(values) != 1 or not values[0]:
        raise RuntimeError("Client gate credential is not available")
    return values[0]


def verify_client_gate(expected_user):
    if not isinstance(expected_user, str) or not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", expected_user):
        raise ValueError("Invalid expected client account")
    client = service_ready("bc250-llm-client.service", expected_user)
    gate = service_ready("bc250-llm-gate.service", "ai-gate")
    admin = read_key("gate-admin-key")
    if not hmac.compare_digest(process_gate_key(client), admin.encode("utf-8")):
        raise RuntimeError("Client gate credential mismatch")
    check_gate_identity(admin, "admin")
    if (client != service_ready("bc250-llm-client.service", expected_user)
            or gate != service_ready("bc250-llm-gate.service", "ai-gate")):
        raise RuntimeError("A service restarted during verification")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-user", required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run as root")
    try:
        verify_client_gate(args.expected_user)
    except Exception:
        raise SystemExit("클라이언트 gate 키 검증에 실패했습니다. 서비스와 설정을 확인하세요.") from None
    print("클라이언트 gate 관리자 키와 서비스 상태 확인 완료")


if __name__ == "__main__":
    main()
