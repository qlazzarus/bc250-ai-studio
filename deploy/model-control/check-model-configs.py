#!/usr/bin/env python3
"""Read-only syntax and GGUF checks; never print configuration values."""

import os
import re
import stat
from pathlib import Path

BASE = Path("/opt/ai/config")
NAME = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
LINE = re.compile(r"([A-Z][A-Z0-9_]*)=([A-Za-z0-9_+./:-]*)\Z")


def check_file(path):
    if not NAME.fullmatch(path.stem) or path.is_symlink():
        raise ValueError("이름 또는 심볼릭 링크")
    raw = path.read_bytes()
    if len(raw) > 16384:
        raise ValueError("설정 파일 크기")
    values = {}
    for number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = LINE.fullmatch(line)
        if not match:
            raise ValueError(f"지원하지 않는 구문, {number}행")
        if match[1] in values:
            raise ValueError(f"중복 설정, {number}행")
        values[match[1]] = match[2]
    model_path = values.get("MODEL_PATH", "")
    if (not model_path.startswith("/") or os.path.normpath(model_path) != model_path
            or not model_path.endswith(".gguf") or values.get("MODEL_NAME", path.stem) != path.stem):
        raise ValueError("모델 이름 또는 파일 경로 형식")
    info = os.stat(model_path)
    if not stat.S_ISREG(info.st_mode) or info.st_size == 0:
        raise ValueError("모델 파일이 없거나 비어 있음")


def main():
    models = sorted((BASE / "models").glob("*.conf"))
    if not models:
        raise SystemExit("검사할 모델 설정이 없습니다.")
    failed = False
    for path in models:
        try:
            check_file(path)
            print(f"{path.name}: 정상")
        except (OSError, UnicodeError):
            failed = True
            print(f"{path.name}: 읽기 또는 모델 파일 확인 실패")
        except ValueError as error:
            failed = True
            print(f"{path.name}: 확인 필요 ({error})")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
