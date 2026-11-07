#!/usr/bin/env bash
# Studio release checks. Preserved model-controller/VM research is a separate suite.
set -euo pipefail
cd "$(dirname "$0")/.."
python_bin=${STUDIO_TEST_PYTHON:-python3}
exec "$python_bin" -m pytest -q \
  backend/tests/test_api.py \
  backend/tests/test_moss.py \
  backend/tests/test_sdcpp.py \
  backend/tests/test_gpu.py \
  backend/tests/test_gpu_owned_holds.py \
  backend/tests/test_gate.py \
  backend/tests/test_gate_holds.py \
  backend/tests/test_llm_adapter.py \
  backend/tests/test_secure_gpu_lock.py \
  backend/tests/test_coordination_capability.py \
  backend/tests/test_studio_independence.py \
  backend/tests/test_studio_deploy.py "$@"
