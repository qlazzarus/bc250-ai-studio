import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "deploy/model-control/check-model-configs.py"
spec = importlib.util.spec_from_file_location("check_model_configs", SCRIPT)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def test_config_checker_matches_literal_contract_without_printing_values(tmp_path, capsys, monkeypatch):
    models = tmp_path / "models"
    models.mkdir()
    gguf = tmp_path / "test.gguf"
    gguf.write_bytes(b"test")
    (models / "valid.conf").write_text(f"MODEL_NAME=valid\nMODEL_PATH={gguf}\n")
    (models / "invalid.conf").write_text('MODEL_PATH=$(echo secret-never-print)\n')
    (models / "badutf.conf").write_bytes(b"secret-never-print\xff")
    monkeypatch.setattr(check, "BASE", tmp_path)
    with pytest.raises(SystemExit):
        check.main()
    output = capsys.readouterr().out
    assert "valid.conf: 정상" in output
    assert "invalid.conf: 확인 필요" in output
    assert "secret-never-print" not in output and str(gguf) not in output
