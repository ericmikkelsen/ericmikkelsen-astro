# Color Layers Modules

This folder keeps color-layers processing isolated from UI work.

- `quantize.ts`
  - Main-thread client for worker calls.
  - Exposes:
    - `quantizeForPreview(...)`
    - `renderLayersWithWebGL(...)`
    - `optimizePngWithOxi(...)`

- `initColorLayers.ts`
  - TypeScript page controller bootstrap for `toys/color-layers`.
  - Handles DOM wiring, settings preview state, layer editing, and export flow.

- `color-processing.worker.ts`
  - Dedicated worker that runs non-UI tasks:
    - WebGL quantization
    - WebGL layer PNG generation
    - oxipng wasm optimization

## Runtime flow

1. Page calls `quantizeForPreview(...)` while settings are open.
2. Page shows swatches from `palette` and raster preview from `quantizedRgba`.
3. On settings confirm/close, page creates layer metadata.
4. Page calls `renderLayersWithWebGL(...)` to receive one PNG per layer.
5. Page injects worker-produced PNGs into SVG `<image>` tags.
6. On export, page calls `optimizePngWithOxi(...)` before download.

## Why this split

- Keeps the page controller focused on UI/events.
- Keeps shader/wasm work off the main thread.
- Keeps worker protocol isolated and easier to review.
