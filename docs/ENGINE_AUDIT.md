# Engine and upstream compatibility audit

Audit date: 2026-11-11

## Current target

- Official upstream repository: https://github.com/OrcaSlicer/OrcaSlicer
- Latest stable release observed: **v2.5.0**, published 2026-11-07.
- Current integration status: **pending**. This workspace does not yet support v2.5.0 and does not yet contain a functional slicer engine.
- Release reference: https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.5.0

## Existing WebAssembly port

Candidate: https://github.com/Hiosdra/OrcaWasm

The current default-branch README identifies the engine as an Emscripten build of OrcaSlicer **v2.4.2**. Its `.gitmodules` pins the OrcaSlicer source checkout to `https://github.com/SoftFever/OrcaSlicer.git`, branch `v2.4.2`. Its build workflow also defaults to `ORCA_VERSION=v2.4.2` and explicitly checks out that tag before applying its compatibility patch set.

This means it is a useful engineering base, but it is not a ready-made v2.5.0 engine.

### Build characteristics

- Emscripten 3.1.74.
- CMake + Ninja.
- Headless `libslic3r` build; no desktop wxWidgets GUI.
- Large native dependency set compiled for WebAssembly, including Boost, GMP/MPFR, CGAL, OCCT, oneTBB, and Emscripten ports.
- Pthread-enabled WebAssembly output (`slicer-mt.js` + `.wasm`).
- Build workflow timeout is 240 minutes; a cold dependency build is substantial.
- Compatibility changes are maintained in `patches/apply.py` plus `overrides/`, CMake modules, and shims. The patcher modifies multiple upstream source/CMake files; it must be checked against every new upstream tag and must not silently ignore important mismatches.

### Engine API and currently documented feature surface

The current README documents one-slicer-api **0.7.0**. The host must query the runtime capability document rather than infer support from exported symbols.

Documented support includes session/configuration, project manifests, slicing, result assets, progress, errors, profile initialization/application, modifier volumes, arrange/auto-orient, multi-plate slicing, project export with slice artifacts, selected conversion operations, and cancellation.

Documented limitations include STEP not being accepted as a project mesh directly (convert to STL first), mapped STEP previews unsupported, project face attributes unsupported, and certain native modifier volume types failing explicitly. This feature list is from the engine README and is not equivalent to the complete desktop UI or all desktop features.

## v2.5.0 compatibility patch audit result

On 2026-11-11, GitHub Actions cloned the current OrcaWasm source and the official OrcaSlicer v2.5.0 tag, applied the v2.5.0-specific patcher adapter, and ran the upstream compatibility patcher in a disposable CI checkout.

Result: **all existing compatibility patches applied successfully; no missing patch anchors or fatal patcher checks remained.** The successful run is recorded at:
https://github.com/temesotejam/layer-workbench/actions/runs/42980109816

The adapter updates the existing OrcaWasm patcher for:
- v2.5.0's already-initialized Arachne parameter fields;
- the updated POSIX thread-naming source layout;
- the v2.5.0 oneTBB CMake file, which now has an MSVC branch before the FLATPAK branch.

This is a source-patching compatibility result only. **It does not prove that the WebAssembly engine compiles, links, runs, or matches desktop output.** The next validation is the manual full build workflow:
https://github.com/temesotejam/layer-workbench/actions/workflows/build-wasm-candidate.yml

## v2.5.0 upgrade risk

The official v2.5.0 release notes describe a major release with many changes, including Python plugins, belt-printer support, filament color mixing, texture displacement, experimental parametric design, IDEX/IQEX multi-part printing, toolhead collision volumes, travel planning, and many fixes.

The existing v2.4.2 patch set therefore cannot be presumed compatible. The v2.5.0 port needs a deliberate patch audit and real output tests. Any desktop feature that depends on GUI frameworks, desktop plugin hosting, or unavailable OS services may require a separate browser implementation or may remain unsupported; that must be documented honestly.

## Browser deployment constraint

The candidate engine is pthread-enabled and requires `SharedArrayBuffer` in a cross-origin-isolated page. Emscripten documents the need for COOP and COEP response headers for deployed pthread builds.

GitHub Pages does not provide direct custom response-header configuration. A service-worker header-rewriting workaround exists, but it has compatibility and cross-origin-resource constraints and must be tested on the actual Pages URL. If it is unreliable, use a static host that supports COOP/COEP while keeping this GitHub repository as the public source of truth.

A single WebAssembly binary cannot simply turn pthreads on/off at runtime. If browser compatibility requires both threaded and non-threaded operation, the engine must be built as separate variants and selected at runtime.

## Next engineering sequence

1. Pin v2.5.0 tag and commit.
2. Run the existing patcher in dry-run/check mode against the exact v2.5.0 checkout.
3. Classify each patch as still required, upstream-fixed, needing rewrite, or obsolete.
4. Port patches and dependency/build changes; fail closed on unexpected source changes.
5. Build the engine and run smoke, API conformance, profile, 3MF, and G-code regression tests.
6. Implement the browser host/UI around the engine, including model viewport, settings, slicing preview, and export.
7. Validate cross-origin isolation on the intended deployment host.
8. Only then mark v2.5.0 as supported and allow the stable-release updater to publish future versions automatically.

## Evidence reviewed

- Official v2.5.0 release: https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.5.0
- OrcaWasm source and README: https://github.com/Hiosdra/OrcaWasm
- OrcaWasm build workflow: https://github.com/Hiosdra/OrcaWasm/blob/master/.github/workflows/build-wasm.yml
- OrcaWasm submodule configuration: https://github.com/Hiosdra/OrcaWasm/blob/master/.gitmodules
- Emscripten pthread deployment requirements: https://emscripten.org/docs/porting/pthreads.html
- GitHub Pages COOP/COEP workaround discussion: https://github.com/orgs/community/discussions/13309
