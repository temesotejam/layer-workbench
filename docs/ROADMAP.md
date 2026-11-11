# Development roadmap

## Phase 0 — Repository foundation
- [x] Establish the personal public repository.
- [x] Add a minimal static workspace shell.
- [x] Add GitHub Pages deployment workflow.
- [x] Add a daily stable-release detector that opens a tracking issue when a new stable version appears.
- [x] Record the current upstream target and initial engine audit.
- [x] Add a GitHub Actions dry-run workflow for the existing WebAssembly compatibility patches.

## Phase 1 — Upstream and license audit
- [x] Identify the current stable upstream target (v2.5.0).
- [x] Identify the existing WebAssembly engine candidate and its v2.4.2 base.
- [x] Identify the pthread/COOP/COEP deployment constraint.
- [ ] Run and classify the compatibility patch dry-run against v2.5.0.
- [ ] Pin the exact v2.5.0 source commit and dependency revisions.
- [ ] Audit every bundled dependency and license at exact revisions.
- [x] Identify major desktop/WebAssembly architecture gaps and feature-level reuse candidates. See [WEB_PORT_SOURCE_AUDIT.md](WEB_PORT_SOURCE_AUDIT.md).
- [ ] Validate the Texture Displacement core and OpenCV-dependent paths in an actual WASM build.

## Phase 2 — Engine port
- [ ] Port the engine from v2.4.2 to v2.5.0.
- [ ] Build the engine reproducibly in CI.
- [ ] Load and apply printer, filament, and process profiles.
- [ ] Validate project import/export and G-code generation.
- [ ] Add regression fixtures and compare outputs.

## Phase 3 — Browser application
- [ ] Add 3D viewport and model manipulation.
- [ ] Add the full settings interface and workflows.
- [ ] Add slicing progress, preview, and G-code export.
- [ ] Validate keyboard shortcuts and project workflows.
- [ ] Validate the complete experience against the desktop application.

## Phase 4 — Stable-release maintenance
- [x] Detect new stable upstream releases.
- [ ] Automatically prepare an integration candidate for each new stable release.
- [ ] Build and test each candidate in isolation.
- [ ] Publish only after all required checks pass.
- [ ] Keep the previous known-good deployment on failure.

## Non-negotiable quality goal

The goal is to preserve upstream behavior as closely as technically possible, not to create a simplified independent slicer. Any unsupported feature must be documented clearly and must not be presented as implemented.
