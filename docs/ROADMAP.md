# Staged delivery

- Phase 0: local inventory, read-only server probe, architecture/API/model/deployment contracts.
- Phase 1: shared persistent generation API, fake/real adapters, GPU lifecycle,
  recovery, auth, batches, SSE and CPU-only verification. See TESTING.md for evidence.
- Phase 2: React+TypeScript+Vite NSFW Art Studio, model-aware inputs, presets,
  batch queue, protected gallery, reproducible-settings reuse, and recoverable
  archive/delete from the archive view.
- Phase 3: Pixel Art Studio, project Art Bible and asset versions; Pillow resize,
  palette, background adapter (solid color first, optional ML), trim/center,
  approval, transparent PNG and exact Phaser atlas + manifest. Required default
  dimensions: unit 64, building 128, terrain/item 32; configurable per project.
  Tests cover originals preserved, transparency, palette and atlas coordinates.
- Phase 4: authenticated RP/LLM backend gateway, durable conversation messages,
  explicit message-to-image requests, and message/job/asset association. The
  browser never calls llama directly; all LLM traffic uses the admission gate.
  Start non-streaming because the present gate buffers upstream responses. Natural
  language image intent is a later, confirmable addition after explicit-action
  flow is stable. See [LLM client handoff](NEXT_PROJECT_LLM_CLIENT.md).
- Phase 5 (design only): ComfyUI, LoRA/ControlNet, character directions/animation,
  remote workers, Orange Pi cluster, Redis/PostgreSQL.

Real GPU tests require explicit operator approval and environment verification.
Phase 1 does not certify BC-250 operation without those tests. A fake PNG proves
queue/storage/API behavior, not model inference or pixel-art generation quality.

## This delivery

Phase 0, Phase 1, and Phase 2 are implemented locally. Validation:
51 backend tests passed; the web client lint and production build passed. The BC-250
Klein Q4, Realistic Vision v6, and their real Vulkan executions have been verified.
The LLM contract probe confirmed both completion and chat-completion endpoints; the
next project's backend handoff is documented before Phase 3/4 work begins.

Phase 3 foundation is now implemented locally: project/Art Bible persistence,
semantic Pixel Assets, Pillow-derived transparent versions, approval, protected file
delivery, and an initial React Pixel Studio view. Shared-queue candidate generation
and Phaser Atlas export remain Phase 3 follow-up units. See
[Pixel Studio](PIXEL_STUDIO.md).
