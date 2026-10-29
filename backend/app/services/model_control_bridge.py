"""Unix-socket bridge for a single reconciled model worker (not enabled by default)."""

import asyncio
import json
import socket
import struct

from app.services.switch_operations import IdempotencyConflict, OperationConflict
from app.services.switch_worker import ReconciliationError

MAX_MESSAGE = 4096
MAX_RESPONSE = 65536
PRINCIPAL = "single-admin"


class ModelControlBridge:
    def __init__(self, worker, allowed_uid, *, switch_enabled=True):
        self.worker = worker
        self.allowed_uid = allowed_uid
        self.tasks = set()
        self.healthy = False
        self.switch_enabled = switch_enabled

    def start(self):
        pending = self.worker.startup()
        if pending and self.worker.store.get(PRINCIPAL, pending["id"]) is None:
            self.worker.close()
            raise ReconciliationError("Unrecognized operation principal")
        self.healthy = True
        if self.switch_enabled and pending and pending["state"] == "queued":
            self._schedule(pending["id"])

    async def close(self):
        self.healthy = False
        if self.tasks:
            await asyncio.gather(*tuple(self.tasks), return_exceptions=True)
        self.worker.close()

    def _schedule(self, operation_id, *, recovery=False, resolve=False):
        method = (self.worker.resolve_verified if resolve else
                  self.worker.recover if recovery else self.worker.run)

        async def run():
            try:
                return await method(PRINCIPAL, operation_id)
            except (ReconciliationError, OperationConflict):
                if not (recovery or resolve):
                    raise
                # The operation remains recovery_required; permit an operator
                # to correct the precondition and retry without restarting.
                return None

        task = asyncio.create_task(run())
        self.tasks.add(task)

        def finished(done):
            self.tasks.discard(done)
            if done.cancelled() or done.exception() is not None:
                self.healthy = False

        task.add_done_callback(finished)

    async def dispatch(self, request, *, administrator=False):
        if not isinstance(request, dict):
            raise ValueError("Invalid request")
        operation = request.get("operation")
        if operation == "models" and set(request) == {"operation"}:
            service = self.worker.switch.service
            models, current = await service.installed(), await service.current()
            return {"models": [{"name": name, "current": name == current} for name in models],
                    "current": current}
        if operation == "submit" and set(request) == {"operation", "model", "idempotency_key"}:
            if not self.switch_enabled:
                return {"error": "switch_disabled"}
            if not self.healthy:
                raise ReconciliationError("Worker unavailable")
            result, created = await self.worker.submit(
                PRINCIPAL, request["model"], request["idempotency_key"]
            )
            if created:
                self._schedule(result["id"])
            return result
        if operation == "pending" and set(request) == {"operation"} and administrator:
            return {"operation": self.worker.store.unresolved()}
        if operation == "recover" and set(request) == {"operation", "id"} and administrator:
            if not self.switch_enabled:
                return {"error": "switch_disabled"}
            if not self.healthy or self.tasks:
                raise OperationConflict("Worker is busy")
            result = self.worker.store.get(PRINCIPAL, request["id"])
            if result is None or result["state"] != "recovery_required":
                raise OperationConflict("Recovery is not available")
            self._schedule(result["id"], recovery=True)
            return result
        if operation == "resolve_verified" and set(request) == {"operation", "id"} and administrator:
            if not self.healthy or self.tasks:
                raise OperationConflict("Worker is busy")
            result = self.worker.store.get(PRINCIPAL, request["id"])
            if result is None or result["state"] != "recovery_required":
                raise OperationConflict("Recovery is not available")
            self._schedule(result["id"], resolve=True)
            return result
        if operation == "get" and set(request) == {"operation", "id"}:
            try:
                result = self.worker.store.get(PRINCIPAL, request["id"])
            except ValueError:
                return {"error": "not_found"}
            if result is None:
                return {"error": "not_found"}
            return result
        raise ValueError("Invalid request")

    async def handle(self, reader, writer):
        try:
            peer = writer.get_extra_info("socket")
            _, uid, _ = struct.unpack("3i", peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid not in {self.allowed_uid, 0}:
                response = {"error": "forbidden"}
            else:
                raw = await asyncio.wait_for(reader.readline(), timeout=5)
                if len(raw) > MAX_MESSAGE or not raw.endswith(b"\n"):
                    raise ValueError("Invalid message")
                response = await self.dispatch(json.loads(raw), administrator=uid == 0)
        except IdempotencyConflict:
            response = {"error": "idempotency_conflict"}
        except OperationConflict:
            response = {"error": "switch_busy_or_recovery_required"}
        except (ValueError, UnicodeError, asyncio.LimitOverrunError):
            response = {"error": "invalid_request"}
        except Exception:
            response = {"error": "service_unavailable"}
        try:
            encoded = json.dumps(response, separators=(",", ":")).encode() + b"\n"
            if len(encoded) > MAX_RESPONSE:
                encoded = b'{"error":"service_unavailable"}\n'
            writer.write(encoded)
            await writer.drain()
        except (ConnectionError, OSError):
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass


class ModelControlClient:
    def __init__(self, path):
        self.path = str(path)

    async def request(self, operation, **arguments):
        data = json.dumps({"operation": operation, **arguments}, separators=(",", ":")).encode() + b"\n"
        if len(data) > MAX_MESSAGE:
            raise ValueError("Message too large")
        reader, writer = await asyncio.wait_for(
            asyncio.open_unix_connection(self.path, limit=MAX_RESPONSE), timeout=5)
        try:
            writer.write(data)
            await writer.drain()
            raw = await asyncio.wait_for(reader.readline(), timeout=10)
            if len(raw) > MAX_RESPONSE or not raw.endswith(b"\n"):
                raise RuntimeError("Invalid worker response")
            response = json.loads(raw)
            if not isinstance(response, dict):
                raise RuntimeError("Invalid worker response")
            return response
        finally:
            writer.close()
            await writer.wait_closed()
