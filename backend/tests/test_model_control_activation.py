"""Exercise the systemd socket-activation contract with a real subprocess."""

import asyncio
import os
import signal
import socket
import subprocess
import sys
import tempfile

from app.services.model_control_bridge import ModelControlClient

CHILD = r'''
import asyncio
import os
import pwd
import socket
import sys
from types import SimpleNamespace
from app.services import model_control_runtime as runtime

fd = int(sys.argv[1])
os.dup2(fd, 3)
runtime.SOCKET = sys.argv[2]
os.environ["LISTEN_PID"] = str(os.getpid())
os.environ["LISTEN_FDS"] = "1"

class Service:
    async def installed(self):
        return ["old", "new"]
    async def current(self):
        return "old"

class Worker:
    def __init__(self):
        self.switch = SimpleNamespace(service=Service())
    def startup(self):
        return None
    def close(self):
        pass

runtime.ControlSettings = lambda: SimpleNamespace(switch_enabled=False)
runtime.build_worker = lambda settings: Worker()
runtime.pwd.getpwnam = lambda name: SimpleNamespace(pw_uid=os.getuid())
asyncio.run(runtime.serve())
'''


async def test_socket_activation_serves_and_shuts_down_without_switching():
    with tempfile.TemporaryDirectory(prefix="activation-") as directory:
        path = os.path.join(directory, "model.sock")
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(path)
        listener.listen()
        child = subprocess.Popen(
            [sys.executable, "-c", CHILD, str(listener.fileno()), path],
            pass_fds=(listener.fileno(),), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        listener.close()
        try:
            client = ModelControlClient(path)
            for _ in range(300):
                if child.poll() is not None:
                    raise AssertionError("activated worker exited before serving")
                try:
                    result = await client.request("models")
                    break
                except (OSError, asyncio.TimeoutError):
                    await asyncio.sleep(0.01)
            else:
                raise AssertionError("activated worker did not start")
            assert result["current"] == "old"
            assert await client.request("submit", model="new", idempotency_key="test") == {
                "error": "switch_disabled"
            }
            child.send_signal(signal.SIGTERM)
            assert await asyncio.to_thread(child.wait, 5) == 0
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stdout.close()
            child.stderr.close()
