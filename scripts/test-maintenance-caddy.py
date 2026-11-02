#!/usr/bin/env python3
"""Exercise a maintenance Caddyfile on disposable loopback ports, never reload Caddy."""

import argparse
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class WikiFixture(BaseHTTPRequestHandler):
    def do_GET(self):
        body = ("wiki-fixture:" + self.path).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    caddy = shutil.which("caddy")
    if not caddy:
        raise SystemExit("caddy 실행 파일을 찾을 수 없습니다.")
    candidate = args.candidate.read_text(encoding="utf-8")
    replacements = {
        ":80 {": None,
        "/opt/bc250-llm-client/frontend/dist": None,
        "/opt/bc250-ai-studio/frontend/dist": None,
        "127.0.0.1:8020": None,
    }
    if any(candidate.count(key) != 1 for key in replacements):
        raise SystemExit("후보 구성의 시험 대상이 예상과 다릅니다.")

    with tempfile.TemporaryDirectory(prefix="bc250-caddy-test-") as temp:
        root = Path(temp)
        for name in ("studio", "client"):
            folder = root / name
            folder.mkdir()
            (folder / "index.html").write_text(name + "-fixture", encoding="utf-8")

        wiki = ThreadingHTTPServer(("127.0.0.1", 0), WikiFixture)
        thread = threading.Thread(target=wiki.serve_forever, daemon=True)
        thread.start()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]

        replacements.update({
            ":80 {": f"http://127.0.0.1:{port} {{",
            "/opt/bc250-llm-client/frontend/dist": str(root / "client"),
            "/opt/bc250-ai-studio/frontend/dist": str(root / "studio"),
            "127.0.0.1:8020": f"127.0.0.1:{wiki.server_port}",
        })
        config = candidate
        for old, new in replacements.items():
            config = config.replace(old, new)
        config = "{\n    admin off\n    auto_https off\n}\n" + config
        config_path = root / "Caddyfile"
        config_path.write_text(config, encoding="utf-8")
        env = {**os.environ, "XDG_CONFIG_HOME": str(root), "XDG_DATA_HOME": str(root)}
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def get(path):
            try:
                with opener.open(f"http://127.0.0.1:{port}{path}", timeout=3) as response:
                    return response.status, response.headers, response.read()
            except urllib.error.HTTPError as error:
                return error.code, error.headers, error.read()

        with (root / "caddy.log").open("w+", encoding="utf-8") as log:
            process = subprocess.Popen(
                [caddy, "run", "--config", str(config_path), "--adapter", "caddyfile"],
                stdout=log, stderr=log, env=env,
            )
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        log.flush()
                        log.seek(0)
                        raise RuntimeError("시험용 Caddy 시작 실패:\n" + log.read()[-4000:])
                    try:
                        get("/api/probe")
                        break
                    except (OSError, TimeoutError):
                        time.sleep(0.1)
                else:
                    raise RuntimeError("시험용 Caddy에 접속하지 못했습니다.")

                for path in ("/api/probe", "/llm/api/probe"):
                    status, headers, _ = get(path)
                    if status != 503 or headers.get("Retry-After") != "120":
                        raise RuntimeError(f"점검 응답 확인 실패: {path} / {status}")
                print("두 API 경로의 503 및 재시도 안내 확인")

                for path, expected in (
                    ("/", b"studio-fixture"),
                    ("/llm/", b"client-fixture"),
                    ("/wiki/probe", b"wiki-fixture:/probe"),
                ):
                    status, _, body = get(path)
                    if status != 200 or body != expected:
                        raise RuntimeError(f"기존 경로 확인 실패: {path} / {status}")
                print("Studio·LLM 정적 경로와 Wiki 프록시 확인")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                wiki.shutdown()
                wiki.server_close()
                thread.join(timeout=5)


if __name__ == "__main__":
    main()
