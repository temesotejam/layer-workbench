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

## Full-build attempt: desktop embedded Python dependency

The first full v2.5.0 CMake configure reached the root project but failed at the desktop embedded-Python block. v2.5.0 now requires an exact bundled CPython 3.12.13 interpreter and embed library, while the existing headless WASM build does not build that dependency. The failing check was `find_package(Python3 3.12.13 EXACT COMPONENTS Interpreter Development.Embed)`.

The current WASM candidate is configured with `SLIC3R_GUI=OFF`; the Python embed target is consumed by the desktop GUI/plugin target. The v2.5.0 adapter now wraps the embedded-Python/pybind11 setup in `if(NOT SLIC3R_WASM)` for the headless engine build. This deliberately does **not** claim that desktop Python plugins are supported in the browser; that remains a separate feature-parity item.

The corrected adapter has passed the compatibility patch audit again:
https://github.com/temesotejam/layer-workbench/actions/runs/42998697619

A new full WebAssembly candidate build is currently running:
https://github.com/temesotejam/layer-workbench/actions/runs/42998697663

Do not mark the engine as v2.5.0-supported until this build reaches the compile/link stage and the API, smoke, and binding tests pass.

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

## Latest failure diagnosis: SolveSpace CAD dependency

The v2.5.0 candidate progressed through the dependency build and reached the upstream `src/libslic3r/CMakeLists.txt`, then CMake failed at `find_package(SLVS REQUIRED)`. In v2.5.0, `SLIC3R_CAD` defaults to ON and enables the Parametric Design/CAD sources, which require the SolveSpace `SLVS` package. The current OrcaWasm dependency build does not build/install that package.

For the first headless slicing/model-engine candidate, Parametric Design is explicitly outside the initial scope. The adapter now adds `-DSLIC3R_CAD=OFF` to the disposable OrcaWasm CMake invocation, preserving the regular slicer and OCCT paths while excluding the optional SolveSpace CAD subsystem. This is a scope decision, not a claim that CAD is ported; CAD remains a future separate dependency/feature project.

The previous full build failed here:
https://github.com/temesotejam/layer-workbench/actions/runs/42998864186

The new adapter and workflow change have been committed. Their CI validation is now triggered. The next gate is whether CMake configure proceeds past the SLVS lookup and enters compilation.


## 2026-11-11: CGAL 6.2.1 compatibility update

Candidate run [#43010651336](https://github.com/temesotejam/layer-workbench/actions/runs/43010651336) confirmed that the headless `SLIC3R_CAD=OFF` setting resolved the previous SolveSpace/SLVS configuration blocker. The next CMake blocker was a **dependency version mismatch**: official OrcaSlicer v2.5.0 calls `find_package(CGAL 6.2 REQUIRED)` while the pinned OrcaWasm recipe installs CGAL 5.6.2.

The v2.5.0 adapter now updates that **disposable** OrcaWasm recipe to CGAL 6.2.1, matching the version selected by OrcaSlicer's official `deps/CGAL/CGAL.cmake`. It also bumps the math dependency stamp to avoid incorrectly reusing a previously completed 5.6.2 install. The candidate workflow's dependency cache key is likewise versioned for CGAL 6.2.1, with its broad cross-version fallback removed.

The candidate remains **unverified** until CMake configuration, C++ compilation, linking, API conformance, async binding and the real end-to-end `scripts/smoke-test.mjs` checks pass and the `.wasm` and `.js` artifacts are uploaded. A passing patch audit alone is **not** a successful WebAssembly build. Headless CAD/parametric design remains disabled in this candidate, not implemented.

The full build remains manual-dispatch-only to prevent every small commit from launching an expensive rebuild. A controlled compatibility test run was queued for the CGAL change; the manual-only policy was then restored. A later workflow change adds the end-to-end smoke test to subsequent runs.


## 2026-11-11: Assimp dependency blocker

Candidate build [#43015046508](https://github.com/temesotejam/layer-workbench/actions/runs/43015046508) completed with a CMake error at `src/libslic3r/CMakeLists.txt:629`: `find_package(assimp REQUIRED)` could not locate `assimpConfig.cmake` or `assimp-config.cmake`. The previous CGAL version requirement was passed, confirming that the CGAL 6.2.1 upgrade and `SLIC3R_CAD=OFF` allow configuration to progress farther.

Unlike the optional parametric CAD subsystem, Assimp is linked directly by `libslic3r` and is used for imported mesh formats. Skipping its CMake discovery without implementing or building its functionality would be an invalid workaround. Official OrcaSlicer v2.5.0 pins Assimp **v5.4.3** (SHA-256 `66dfbaee288f2bc43172440a55d0235dfc7bf885dda6435c038e8000e79582cb`) with GLTF/OBJ/FBX import enabled. The new `scripts/build-assimp-wasm.sh` builds that version as a static wasm32 library via Emscripten and installs its `assimp::assimp` CMake package into the existing `orcawasm/deps-install` prefix. No desktop library or unverified stub is substituted.

The candidate workflow now invokes this dependency builder before the OrcaWasm build, and it saves *completed* dependency installs when the subsequent CMake configure fails (using Assimp, CGAL and oneTBB completion stamps). This avoids repeatedly paying for a cold dependency build while ensuring partially built dependencies are not cached as complete. Cache keys are separated by Assimp version.

The audit workflow uses the same pinned OrcaWasm revision as the candidate and verifies the Assimp script's shell syntax, version, official archive checksum and required importers. Current fresh candidate: [#43027406588](https://github.com/temesotejam/layer-workbench/actions/runs/43027406588). Fresh audit: [#43027478702](https://github.com/temesotejam/layer-workbench/actions/runs/43027478702).

This is an attempted build-system fix, **not yet a successful cross-compilation claim**. The candidate still needs full CMake configuration, C++ compilation/link, conformance/binding/smoke tests, and artifact checks. Desktop Parametric Design/CAD is explicitly outside this headless candidate.

## 2026-11-12: Draco 1.5.7 dependency blocker

The candidate [#43027406588](https://github.com/temesotejam/layer-workbench/actions/runs/43027406588) completed unsuccessfully at the OrcaSlicer v2.5.0 CMake configuration phase. The preceding Assimp 5.4.3 WebAssembly build and the long dependency build both succeeded, but `src/libslic3r/CMakeLists.txt:695 (find_package)` required Draco and `cmake/modules/FindDraco.cmake` reported `Draco library not found. Please install the dependency.` This is the next actual failure after resolving CGAL 6.2.1 and Assimp.

Official OrcaSlicer v2.5.0 pins Google Draco **1.5.7**, archive SHA-256 `27b72ba2d5ff3d0a9814ad40d4cb88f8dc89a35491c0866d952473f8f9416b77` (`deps/Draco/Draco.cmake`). The new `scripts/build-draco-wasm.sh` downloads and verifies that exact archive, builds the genuine C++ library with the same Emscripten pthread/exception flags as the engine and installs the exported `draco::draco` CMake package and headers under `orcawasm/deps-install`. Browser-specific standalone JS glue is disabled because the engine links the C++ library directly. This is **not** a stub bypass.

The candidate workflow now builds Draco before configuring OrcaSlicer. To avoid repeated expensive compilation, it may restore the fully built preceding CGAL/Assimp/OCCT/oneTBB cache, while the new cache key (`draco-1.5.7`, v4) and completion stamp distinguish the newly added dependency. The cache is saved only after all required stamps exist.

The [new patch/dependency audit #43046904876](https://github.com/temesotejam/layer-workbench/actions/runs/43046904876) passed, including syntax and version/hash/flag checks for the new Draco recipe. The new [candidate build #43047097790](https://github.com/temesotejam/layer-workbench/actions/runs/43047097790) has been triggered. The patch audit is *static*: it does not prove that Draco compilation or the complete engine succeeds.

No engine success or WebAssembly artifact is claimed. CMake configure, C++ compilation/link, API conformance, asynchronous binding, real slice smoke test and uploaded `.wasm`/`.js` files are still awaiting successful verification. The independent static workspace deployment is not an engine acceptance signal.

## 2026-11-12 01:40 JST: runner mirror DNS failure and APT-free bootstrap

Full candidate run [#43051471275](https://github.com/temesotejam/layer-workbench/actions/runs/43051471275) failed **before source checkout or compilation**, during its `apt-get update` step. GitHub-hosted Ubuntu 24.04's Azure Ubuntu mirror name `azure.archive.ubuntu.com` could not be resolved. Three attempts (with retries and timeouts) all failed, so this run provides **no evidence** that the CGAL/Assimp/Draco fixes work or fail.

For the next run, the heavyweight candidate workflow replaces the redundant APT upgrade/install step with `scripts/prepare-wasm-runner.sh`. That script verifies the tools already included in the published Ubuntu 24.04 hosted image, checks native OpenSSL headers, and only installs a tiny local pass-through `ccache` launcher if a `ccache` binary is absent. The shim invokes the real compiler without claiming to cache output. It fails explicitly if an indispensable tool is absent rather than attempting an unverified package source or silently omitting dependencies. The patch audit now executes the same bootstrap check.

The update does not change upstream OrcaSlicer, OrcaWasm dependency sources, public deployed assets, or licensing. The new audit and full candidate run were triggered by the workflow changes. A passing tool bootstrap still does **not** establish successful configuration, C++ linking, API conformance, async binding, smoke tests, or generated `.wasm` artifacts.

Relevant runner inventory: https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md
