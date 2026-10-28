# Model registry

config/models.yaml is operator-owned configuration. Paths are configuration data,
not hardcoded in Python. Files are checked whenever listed or submitted. Existence
only proves availability; tested requires an operator-recorded hardware test.
Missing files override validation state to unavailable. The Realistic Vision v6
checkpoint at `/opt/sd-models/realistic-vision-v6-fp16.safetensors` has a recorded
BC-250 Vulkan test: 512×512, 15 Euler steps, CFG 7, seed 42, 9.77 seconds of
generation, with `--backend Vulkan0`. It is enabled and marked `tested`.
Miraclein is not registered or downloaded. Fake model is only enabled in fake mode.

Presets are family-specific. Z-Image NSFW defaults to 768x768 / 6 steps, with 4/6/8
step presets. Sampling flags are trusted registry configuration and must be
validated against the installed binary.

## Generation option capabilities

Each model has `generation_options` in `config/models.yaml`; the Registry validates
that structure and exposes it through `/models`. `supported_parameters` remains
the legacy admission list for dimensions/steps, while `generation_options` is the
single policy source for CFG, negative prompt, sampler, and scheduler. Do not add a
CLI flag merely because the installed binary recognizes it.

| Model | CFG / negative prompt policy | Sampler / scheduler policy |
| --- | --- | --- |
| PornMaster Klein 9B Turbo | Verified at 512×512 / 4 steps / Euler / seed 4242 for CFG `1.0`, `1.5`, `2.0`; a non-empty negative prompt was verified at CFG `2.0`. The 8-step recipe remains unverified. | Euler fixed; scheduler omitted. |
| Klein 4B Q4/Q8 | CFG `1.0` fixed; negative prompt unsupported. | Euler fixed; scheduler omitted. |
| Z-Image Turbo / NSFW v2 | CFG `1.0` fixed; negative prompt unsupported. Do not map Diffusers guidance values to `sd-cli` CFG. | Euler fixed; scheduler omitted. |
| Realistic Vision V6 | Existing CFG range `0..30` and negative prompt are verified Studio behavior. | Euler fixed; scheduler omitted. DPM++/Karras mapping is not established. |
| Fake | CFG range `0..30` and negative prompt test API semantics only. | No `sd-cli` execution. |

`experimental` means the model-card setting is documented but it is not a
BC-250/sd-cli quality, memory, or stability certification. `fixed` preserves the
current Studio invocation; it is not a statement that the CLI could not parse a
different value. See [MODEL_OPTIONS_CONTRACT.md](MODEL_OPTIONS_CONTRACT.md) for
the exact API conditions and [SDCLI_OPTIONS_AUDIT.md](SDCLI_OPTIONS_AUDIT.md) for
the installed binary evidence.

Upstream reference (not proof of installed CLI compatibility):
https://github.com/leejet/stable-diffusion.cpp
https://github.com/leejet/stable-diffusion.cpp/blob/master/docs/flux2.md
https://github.com/leejet/stable-diffusion.cpp/blob/master/docs/z_image.md
https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md

Record binary version/hash, help output, Vulkan device, invocation, duration,
resolution, seed and result before setting validation_status: tested. The reported
user benchmarks are planning inputs only, not reproduced measurements.
