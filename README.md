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

This repository is at the initial project-scaffolding stage. It does **not** yet contain a working slicer engine, printer profiles, or a functional slicing workflow. The initial website is only a project shell.

The current stable integration target is **v2.5.0**, but it is **not yet supported** by this workspace. The existing WebAssembly engine candidate is based on v2.4.2 and requires a substantial compatibility audit and port before it can be considered for use. See [the engine audit](docs/ENGINE_AUDIT.md), [the detailed desktop-to-web source audit](docs/WEB_PORT_SOURCE_AUDIT.md), [the browser engine API plan](docs/BROWSER_ENGINE_API_PLAN.md), [the v2.5.0 integration issue](https://github.com/temesotejam/layer-workbench/issues/1), and [the first browser editor milestone](https://github.com/temesotejam/layer-workbench/issues/2).

## Stable-release tracking

A scheduled GitHub Actions workflow checks the official upstream stable release once per day. When a new stable tag appears beyond the current integration baseline, it opens a tracking issue. Detection does not imply compatibility, trigger an unverified deployment, or automatically advance the supported version.

The integration baseline in [upstream/stable.json](upstream/stable.json) must only be advanced after a successful build and the required compatibility tests.

## Deployment

The static site is intended to deploy from the `main` branch using GitHub Actions and GitHub Pages. The Pages site is public; do not put credentials, private printer data, personal files, or secrets in this repository or in client-side application code.

The candidate multithreaded engine requires `SharedArrayBuffer` and cross-origin isolation. GitHub Pages does not expose arbitrary response headers; the service-worker workaround and actual browser compatibility have not yet been validated. Hosting may need to change if isolation cannot be made reliable. See [the engine audit](docs/ENGINE_AUDIT.md).

## Licensing and upstream notices

This project may incorporate or adapt upstream slicer code and other third-party components. Their licenses and notices must be preserved. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Before distributing a combined WebAssembly build, review the license of every included dependency and the way the browser application interacts with the engine. In particular, comply with applicable source-offer, attribution, and network-use requirements. This README is not a substitute for the license texts or legal advice.
