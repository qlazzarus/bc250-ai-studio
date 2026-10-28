# Pixel Studio (Phase 3 foundation)

Phase 3 uses the existing Studio API, asset storage, authenticated file delivery,
and single GPU scheduler. It does not introduce another image server or alter the
installed model files, llama service, or GPU transition settings.

## Implemented foundation

- Persistent Pixel projects with an operator-authored Art Bible JSON object.
- Stable semantic Pixel Asset records: `unit`, `building`, `terrain`, `decoration`,
  `item`, `ui`, and `effect`.
- Original-source linkage to an existing active Studio asset.
- Pillow-based derived versions: solid-corner background transparency, alpha trim,
  nearest-neighbour scale, palette quantization, and transparent-canvas centering.
- Approval of exactly one derived version per Pixel Asset.
- Recoverable Pixel Asset archive, restore, and archive-only delete. Delete moves
  derived version PNGs to the private Studio trash directory; the source Studio
  image is never touched.
- Protected version PNG delivery through the same Bearer-authenticated API.
- A Pixel Studio React view for project creation, Art Bible entry, asset registration,
  processing, version preview, and approval.

The default output dimensions in the UI are unit 64×64, building 128×128, and
32×32 for terrain, decoration, item, UI, and effect assets. The API accepts any
multiple-of-eight size from 16 to 2048 for a later advanced UI.

## Current flow

```text
Existing Studio image asset
  -> select/create Pixel Project + Art Bible
  -> register semantic Pixel Asset
  -> Pillow process into a derived transparent PNG version
  -> inspect version
  -> approve one version
```

The source asset stays untouched. Derived versions are stored under the private
Studio data root at `pixel/projects/<project>/<asset>/<version>.png`.

## API

```text
GET/POST /api/v1/projects
GET/PUT  /api/v1/projects/{project_id}
GET/POST /api/v1/projects/{project_id}/assets
POST     /api/v1/assets/{pixel_asset_id}/process
POST     /api/v1/assets/{pixel_asset_id}/approve?version_id=...
GET      /api/v1/pixel/versions/{version_id}/file
```

All routes require the Studio client Bearer key. `POST /process` accepts `width`,
`height`, `palette_colors`, `remove_solid_background`, `trim`, and `center`.

## Deliberately deferred Phase 3 work

- Creating Pixel Asset candidates directly from a project prompt through the shared
  GPU queue, including Art Bible prompt composition.
- Candidate comparison and source-selection UI.
- More robust background removal than the current solid-corner heuristic.
- Phaser Atlas PNG/JSON and asset manifest export.

These follow-on units build on the durable project/asset/version identifiers already
implemented here.
