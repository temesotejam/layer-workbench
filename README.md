# Layer Workbench

A personal browser-based workspace for 3D-print preparation.

This repository is maintained primarily for the owner's own use. It is intended to provide a browser-accessible interface while preserving the behavior, settings model, project compatibility, and slicing results of the upstream desktop slicer as closely as technically possible.

## Project principles

- Track upstream **stable releases**; do not follow beta, release-candidate, or nightly builds.
- Prefer the upstream C++ slicing implementation over a separately implemented slicer.
- Keep browser/UI adaptation code separate from upstream engine code.
- Preserve printer, filament, process, project, and G-code behavior wherever the browser port supports it.
- Run compatibility and regression checks before publishing an updated engine.
- Keep the last known-good deployment if an upstream update cannot be built or validated.
- Keep this repository's identity and presentation personal and independent. Upstream attribution and all applicable license notices remain explicit.

## Current status

This repository is at the initial project-scaffolding stage. It does **not** yet contain a working slicer engine, printer profiles, or a functional slicing workflow. The initial website is only a project shell.

The intended technical investigation starts with the existing WebAssembly port and its exact upstream version, API, build process, supported features, and license obligations. A desktop application and a browser application are not automatically feature-equivalent; unsupported features must be identified rather than represented as complete.

## Stable-release update policy

The planned updater will:

1. Detect new stable upstream releases (excluding prereleases).
2. Pin the exact upstream tag and commit used for each engine build.
3. attempt a reproducible WebAssembly build.
4. Run engine/API, sample-project, G-code, and browser smoke tests.
5. Publish only after all required checks pass.
6. Retain the previous known-good engine and deployment on failure.

A detected release is not considered supported until the build and compatibility tests pass.

## Deployment

The static site is deployed from the `main` branch using GitHub Actions and GitHub Pages. The Pages site is public; do not put credentials, private printer data, personal files, or secrets in this repository or in client-side application code.

## Licensing and upstream notices

This project may incorporate or adapt upstream slicer code and other third-party components. Their licenses and notices must be preserved. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Before distributing a combined WebAssembly build, review the license of every included dependency and the way the browser application interacts with the engine. In particular, comply with applicable source-offer, attribution, and network-use requirements. This README is not a substitute for the license texts or legal advice.
