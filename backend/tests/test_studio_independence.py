"""The image app must not load the retired model-control implementation."""

import subprocess
import sys


def test_studio_import_without_model_control_worker():
    code = '''
import importlib.abc
import sys

class BlockController(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if (fullname.startswith("app.services.model_control")
                or fullname in {"app.services.model_switch", "app.services.switch_worker",
                                "app.services.switch_operations", "app.services.systemd_model"}):
            raise AssertionError("Studio imported model controller: " + fullname)

sys.meta_path.insert(0, BlockController())
from app.main import create_app
from app.services.switch_barrier import decode_switch_journal
assert callable(create_app)
assert decode_switch_journal(b"{}") == {}
'''
    subprocess.run([sys.executable, "-c", code], check=True)
