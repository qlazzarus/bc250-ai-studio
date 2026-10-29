"""Unprivileged management HTTP service; no GPU or systemctl access."""

from app.api.remote_model_management import create_remote_model_management_app
from app.services.model_control_bridge import ModelControlClient
from app.services.model_control_runtime import SOCKET, credential


def create_app():
    return create_remote_model_management_app(ModelControlClient(SOCKET), credential("api-key"))
