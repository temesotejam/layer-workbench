# v2.5.0 WASM browser integration: isolated proof

Updated: 2026-11-12. **Working, tested in Chrome CI; not production integration.**

## Confirmed milestones

- Headless OrcaSlicer v2.5.0 candidate: [build 43144590877](https://github.com/temesotejam/layer-workbench/actions/runs/43144590877) passed one-slicer-api 0.7.0 conformance, binding, and smoke tests.
- Browser engine loader: `engine-probe.html` and `scripts/probe-engine.mjs` load *locally selected* `slicer-mt.js` / `slicer-mt.wasm` files under cross-origin isolation.
- The Emscripten pthreads require a **classic script URL** while the host imports the binding as an ES module. Passing the same ES module URL to pthread workers caused the initial test hang. Separate module and worker script Blob URLs resolved it.
- [Isolated Chrome CI 43241808056](https://github.com/temesotejam/layer-workbench/actions/runs/43241808056) confirmed actual WASM initialization and `OrcaSlicer 2.5.0` capability reporting.
- `scripts/slice-stl.mjs` creates a one-mesh project manifest, initializes the generic test PLA configuration, slices a selected STL via the **native WASM one-slicer-api**, and downloads the returned G-code asset.
- [Isolated Chrome CI 43242447661](https://github.com/temesotejam/layer-workbench/actions/runs/43242447661) **PASS**: generated a real G-code asset from a 12-triangle cube STL in Chrome, via multithreaded WASM. The run downloaded the pinned candidate from GitHub Actions and did not publish WASM binaries to the website.

## Local development-only test

1. Download and extract the artifact from the verified candidate build (files `slicer-mt.js`, `slicer-mt.wasm`). **Only load trusted artifact files:** JavaScript in a locally selected engine artifact is executable code.
2. From the repository root, run `python3 scripts/serve-isolated.py --port 8766`. The server is limited to localhost and adds COOP/COEP headers.
3. Open `http://127.0.0.1:8766/engine-probe.html` in Chrome. Choose the two extracted files and click **Load and inspect engine**.
4. For the functional proof, select a small STL and click **Slice selected STL (test only)**. The generated G-code is a development fixture with **generic PLA settings**, not a verified printer profile. Do not send it to a physical printer.

## Why this is not yet the published slicer

GitHub Pages is serving the static app without verified COOP/COEP isolation. The production Prepare UI does not yet load the WASM artifact, synchronize the rendered model with a native project, export all printer/filament/process profiles, or provide G-code Preview. The successful artifact is deliberately kept outside the published site until hosting, integration, security/licensing and visual regression are reviewed.

## Next acceptance gates

1. Set up a deployment host with validated COOP/COEP, resource hosting, and a stable `SharedArrayBuffer` policy. Preserve the current Pages deployment until a replacement is fully tested.
2. Connect the actual Prepare viewport's selected project file(s) to one-slicer-api. Keep canonical object hierarchy and transform coordinates instead of re-centering or simplifying native project semantics.
3. Use official printer/filament/process profiles rather than the proof's fixed test configuration. Validate profile application and per-object overrides.
4. Generate a slice from the same file shown in the viewport; expose progress, cancellation, G-code download, and error handling.
5. Implement Preview from the G-code toolpaths and compare the generated file numerically against native OrcaSlicer v2.5.0.
6. Validate full 3MF round-trip, advanced editing, texture, CAD and device workflows before claiming complete parity.

A green browser smoke proves one representative flow, **not full desktop equivalence**.
