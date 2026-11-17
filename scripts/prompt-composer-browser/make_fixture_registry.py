"""Generate the browser-verification registry: four fake models, no GPU paths.

Every engine is `fake`, so nothing here claims model quality or support. The
template is local to this file so the registry can be regenerated without any
`/tmp` fixture from an earlier session.

Usage: .venv/bin/python scripts/prompt-composer-browser/make_fixture_registry.py
"""
import copy
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
TARGET = HERE / "models.fixture.yaml"

DECLARATIONS = [
    ("fake-sd15", "Fake sd15 (gap4 fixture)", "sd15"),
    ("fake-sd15-alt", "Fake sd15 ALT (gap4 fixture)", "sd15"),
    ("fake-flux2", "Fake flux2 (gap4 fixture)", "flux2"),
    ("fake-unknown", "Fake unknown-family (gap4 fixture)", "unknown-family"),
]

# Mirrors the `fake` entry of config/models.yaml; only the identity fields differ.
TEMPLATE = {
    "display_name": "Fake sd15 (gap4 fixture)",
    "family": "sd15",
    "engine": "fake",
    "model_path": None,
    "text_encoder_path": None,
    "vae_path": None,
    "quantization": "",
    "supported_resolutions": [[64, 64], [512, 512], [768, 768]],
    "supported_parameters": ["width", "height", "steps", "seed", "cfg_scale", "negative_prompt"],
    "presets": {
        name: {"width": 512, "height": 512, "steps": 1, "cfg_scale": 1.0}
        for name in ("fast", "balanced", "quality")
    },
    "generation_options": {
        "cfg_scale": {"mode": "verified", "default": 1.0, "allowed_values": [],
                      "minimum": 0.0, "maximum": 30.0},
        "negative_prompt": {"mode": "verified"},
        "sampling_method": {"mode": "fixed", "default": None, "allowed_values": []},
        "scheduler": {"mode": "fixed", "default": None, "allowed_values": []},
    },
    "enabled": True,
    "validation_status": "tested",
    "cli_args": [],
}


def main() -> None:
    models = []
    for model_id, display_name, family in DECLARATIONS:
        model = copy.deepcopy(TEMPLATE)
        model.update(model_id=model_id, display_name=display_name, family=family)
        models.append(model)
    TARGET.write_text(yaml.safe_dump({"models": models}, sort_keys=False, allow_unicode=True),
                      encoding="utf-8")
    for model in models:
        print(model["model_id"], model["family"])


if __name__ == "__main__":
    main()
