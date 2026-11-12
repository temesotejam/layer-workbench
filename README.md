# Layer Workbench

A personal browser-based workspace for 3D-print preparation.

This repository is maintained primarily for the owner's own use. It aims to provide a browser-accessible environment while preserving the behavior, settings model, project compatibility, and slicing results of the upstream desktop slicer as closely as technically possible.

## Project principles

- Track upstream **stable releases only**; do not follow beta, release-candidate, or nightly builds.
- Prefer the upstream C++ slicing implementation over a separately implemented slicer.
- Keep browser/UI adaptation code separate from upstream engine code.
- Preserve printer, filament, process, project, and G-code behavior wherever the browser port supports it.
- Run compatibility and regression checks before publishing an updated engine.
- Keep the last known-good deployment if an upstream update cannot be built or validated.
- Keep this repository's identity and presentation personal and independent. Upstream attribution and all applicable license notices remain explicit.

## Current status

The repository now has a successful **OrcaSlicer v2.5.0 headless WebAssembly engine candidate**. The pinned v2.5.0 source has passed the candidate build, one-slicer-api 0.7.0 conformance, asynchronous binding checks, and Node end-to-end smoke tests. This validates the tested engine/API paths; it does **not** establish full desktop feature parity or browser deployment readiness.

The public page is being rebuilt toward an OrcaSlicer-like Prepare workspace. The current UI is still a presentation shell: it can list locally selected STL/3MF/OBJ files, but it does not yet parse/render model geometry, load profiles, invoke the WASM engine, or slice. Preview, Device, save, editing tools, and slice controls remain disabled until their real implementations are connected.

Known feature gaps include the desktop GUI/Gizmos, CAD/Parametric Design, Python plugins, OpenCV-backed texture-to-color conversion, full paint/texture workflows, complete 3MF semantic round-trip, and native-vs-WASM G-code equivalence. See the [engine audit](docs/ENGINE_AUDIT.md), [desktop-to-web source audit](docs/WEB_PORT_SOURCE_AUDIT.md), [browser engine API plan](docs/BROWSER_ENGINE_API_PLAN.md), and [evidence-based parity ledger](docs/V250_PARITY_LEDGER.md).

## Stable-release tracking

A scheduled GitHub Actions workflow checks the official upstream stable release once per day. When a new stable tag appears beyond the current integration baseline, it opens a tracking issue. Detection does not imply compatibility, trigger an unverified deployment, or automatically advance the supported version.

The integration baseline in [upstream/stable.json](upstream/stable.json) must only be advanced after a successful build and the required compatibility tests.

## Deployment

The static site is intended to deploy from the `main` branch using GitHub Actions and GitHub Pages. The Pages site is public; do not put credentials, private printer data, personal files, or secrets in this repository or in client-side application code.

The candidate multithreaded engine requires `SharedArrayBuffer` and cross-origin isolation. GitHub Pages does not expose arbitrary response headers; the service-worker workaround and actual browser compatibility have not yet been validated. Hosting may need to change if isolation cannot be made reliable. See [the engine audit](docs/ENGINE_AUDIT.md).

## Licensing and upstream notices

This project may incorporate or adapt upstream slicer code and other third-party components. Their licenses and notices must be preserved. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Before distributing a combined WebAssembly build, review the license of every included dependency and the way the browser application interacts with the engine. In particular, comply with applicable source-offer, attribution, and network-use requirements. This README is not a substitute for the license texts or legal advice.
