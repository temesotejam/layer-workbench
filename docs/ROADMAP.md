# Development roadmap

## Phase 0 — Repository and deployment foundation
- [x] Establish the personal project repository.
- [x] Add a minimal static workspace shell.
- [x] Add GitHub Pages deployment workflow.
- [x] Add stable-release detection workflow (notification/build integration remains pending).

## Phase 1 — Upstream and license audit
- [ ] Pin the upstream stable desktop release and source commit.
- [ ] Audit the WebAssembly port's current base version and API compatibility.
- [ ] Audit every bundled dependency and license.
- [ ] Define the complete corresponding-source publication strategy.
- [ ] Identify gaps between desktop and WebAssembly feature support.

## Phase 2 — Engine integration
- [ ] Build the WebAssembly engine reproducibly in CI.
- [ ] Load and apply printer, filament, and process profiles.
- [ ] Validate project import/export and G-code generation.
- [ ] Add regression fixtures and compare outputs.

## Phase 3 — Browser application
- [ ] Add 3D viewport and model manipulation.
- [ ] Add complete settings navigation and controls.
- [ ] Add slicing progress, preview, and G-code export.
- [ ] Validate keyboard shortcuts and workflows.

## Phase 4 — Stable-release maintenance
- [ ] Detect new stable upstream releases.
- [ ] Build and test each candidate in isolation.
- [ ] Publish only after required checks pass.
- [ ] Keep the previous known-good deployment on failure.

## Non-negotiable quality goal

The goal is to preserve upstream behavior as closely as technically possible, not to create a simplified independent slicer. Any unsupported feature must be documented clearly and must not be presented as implemented.
