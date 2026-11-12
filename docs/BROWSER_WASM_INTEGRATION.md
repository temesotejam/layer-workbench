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

## 2026-11-12: Prepare UI → actual WASM slice proof

The Prepare viewport now exposes an **explicit opt-in local test** when opened with `?engineLab=1`. See `scripts/prepare-engine-lab.mjs`. The ordinary page does not request engine binaries or enable the test. The lab is disabled if the current host lacks cross-origin isolation. The JavaScript and WASM binaries must be selected locally by the tester. No extra engine files are deployed to Pages.

The importer retains the original `File` for each displayed model. The lab uses the selected STL source bytes and **one-slicer-api** to initialize a generic PLA test session, register the project, invoke the real slicer, retrieve the G-code asset, and offer a local download. Web-only transforms (Move/Rotate/Scale) mark the selection dirty; modified models cannot be sliced in this proof, to avoid silently ignoring changes. Multiple objects, native projects, per-object settings and profiles are not yet synchronized to the engine.

[Isolated Chrome test #43243644692](https://github.com/temesotejam/layer-workbench/actions/runs/43243644692) passed, explicitly logging `PASS: Prepare UI selected STL → local WASM → G-code download`. The test selected a 12-triangle binary STL in the Prepare UI and supplied the pinned WASM artifact only inside CI. This is stronger than the earlier standalone engine probe but still **not a production slice flow**.

Test locally: `python3 scripts/serve-isolated.py --port 8766`, open `http://127.0.0.1:8766/?engineLab=1`, import a small STL, select the verified `slicer-mt.js` / `slicer-mt.wasm` files, start the engine, and click **Slice selected STL (test only)**. Generated G-code is generic PLA fixture output; do not print without proper profile and machine validation.

**Next gates:** preserve model coordinates, translate actual edited transforms and multiple-object plate metadata into native manifests, load full upstream profiles, add preview and cancellation, and verify an isolated production host before integrating the engine into the public UI.

## 2026-11-12: Prepare affine transforms → native WASM test

The isolated Prepare proof now passes the selected STL's **current Three.js model matrix** (not only the original source file) to the OrcaSlicer one-slicer-api project manifest. `scripts/transform-matrix.mjs` converts column-major Three.js storage into the native row-major affine matrix and offsets coordinates from the centered browser plate to the 256 mm bed's lower-left origin. It rejects invalid, singular or non-affine matrices. The original STL bytes remain untouched.

The Prepare UI includes numeric XYZ position, Z rotation, and XYZ scale fields as a reproducible test of these operations; dragging TransformControls updates the same object matrix. **This is still a single-STL, generic-PLA development test**, not full native project editing. Multiple imported models are rejected in the local lab rather than silently omitted.

[Chrome integration run #43244950738](https://github.com/temesotejam/layer-workbench/actions/runs/43244950738) passed:
- independent native-matrix test cases for identity, translation, rotation, non-uniform scale and invalid transforms;
- successful original STL selection and G-code generation;
- numeric X position/Z rotation/X scale edits followed by another real WASM slice;
- a changed G-code SHA-256 after applying those edits.

This establishes that the edited Prepare transform affects the native output on the tested cube, **not** exact correspondence to desktop OrcaSlicer's transform/pivot behavior or a lossless native 3MF round-trip. A hash difference is a smoke-test signal, not a quantified toolpath parity test. Native source profile semantics, complete object hierarchies, multi-plate support, displacement, printer connection and G-code Preview remain unimplemented.

## 2026-11-12: multiple STL objects on one native plate

The isolated Prepare proof now builds a **single one-slicer-api project from multiple STL files**. `scripts/multi-stl.mjs` concatenates each original file into one binary blob, creates unique mesh/object/instance IDs, checks the data ranges, and maps each displayed instance's affine matrix into native coordinates. The local lab accepts 1–24 STL files (80 MB combined limit), and refuses non-STL projects or unsupported plate configurations rather than silently omitting objects. The fixed generic PLA test profile is unchanged.

[Isolated Chrome CI #43245760666](https://github.com/temesotejam/layer-workbench/actions/runs/43245760666) **passed**:
- two-object manifest byte-offset, unique ID and native position unit tests;
- a working single-model slice and a transformed single-model slice;
- importing a second STL through Prepare, moving it on the plate, and generating G-code from one native project containing both objects;
- the two-object G-code hash differed from the single-object G-code hash.

**This does not establish desktop parity or a production multi-plate slicer.** It does not preserve complete 3MF metadata, support native filament presets, independently verify geometry paths for every object, or reproduce automatic arrangement/collision handling. Official profiles, G-code Preview, 3MF semantic round-trip and printer verification remain release blockers.

## 2026-11-12: restricted native process override proof

The isolated Prepare lab now accepts an **optional local process JSON fragment**. `scripts/test-process-profile.mjs` strictly validates only these numeric keys: `layer_height`, `wall_loops`, `sparse_infill_density`, `top_shell_layers`, `bottom_shell_layers`. Unsupported and malformed values are rejected. The bridge invokes `session.applyProfile("orca.native-json", ...)` after initializing its generic PLA test configuration and before registering/slicing the plate.

[Chrome integration run #43246440472](https://github.com/temesotejam/layer-workbench/actions/runs/43246440472) **PASS**: the 2-model project sliced with and without a process JSON fragment containing `layer_height: 0.3` and `wall_loops: 3`; the resulting G-code SHA-256 changed. The same run passed invalid-input unit tests and all previous engine, transform, and 2-object tests.

**Scope:** this is not a full imported OrcaSlicer printer/filament/process profile. Profile inheritance, nozzle/extruder vectors, machine compatibility, filament temperature and speed matrices, start/end G-code and color mapping are not validated. Do not send fixture G-code to an actual machine. Full profile parity remains a release blocker.

## 2026-11-12: G-code-derived per-layer preview

The isolated Prepare lab now includes a **diagnostic 2D layer-by-layer G-code toolpath viewer** implemented in `scripts/gcode-preview-parser.mjs` and `scripts/gcode-layer-preview.mjs`. It uses the G-code bytes returned by the verified browser WASM slice; it does **not** reconstruct paths from the STL display geometry. The parser handles G0/G1 linear movement, absolute and relative coordinate/extruder modes, G92 and millimeter/inch units. It separates positive-extrusion segments from travel, groups by Z coordinate and enforces input/segment limits. Unsupported G2/G3 arcs are counted but not drawn. The canvas has a slider for individual Z levels; test-only G-code is never executed or sent to a printer.

[Chrome CI #43247324788](https://github.com/temesotejam/layer-workbench/actions/runs/43247324788) **PASS**: parser tests for absolute/relative motion, travel, extrusion, layers and error limits; actual WASM-generated toolpaths displayed in the canvas with a functioning layer slider; re-preview of a G-code result after native process overrides (134 Z levels in the tested scenario). All prior WASM, model transform and multi-STL regression checks also passed.

This is **not native OrcaSlicer Preview parity**: no full 3D toolpath geometry, bead widths, speed/feature color legend, extrusion volume simulation, G2/G3 interpolation, firmware-specific behavior, seam/travel semantics, temperature/time estimates or multi-plate preview. The published GitHub Pages workspace continues to keep WASM inactive; the lab requires cross-origin-isolated localhost.

## 2026-11-12: experimental 3D G-code view

The isolated Prepare lab now has a **separate WebGL/Three.js 3D G-code path preview** alongside the previously tested 2D layer canvas. `scripts/gcode-3d-preview.mjs` consumes the parser output derived from **actual WASM G-code**, constructs extrusion and travel line segments in native G-code millimeter coordinates, and exposes camera orbit/zoom and a cumulative visible-through-layer slider. Per-layer geometries are disposed on reslice; no printer execution is enabled.

[Chrome CI #43247981727](https://github.com/temesotejam/layer-workbench/actions/runs/43247981727) **PASS**: the real WASM G-code generated a WebGL canvas with nonzero toolpath segments, and the 3D layer range selector changed visible layer counts from one to the full range. Existing 2D, STL import, native slicing, transforms, multi-object and process-override regressions also passed.

**Limits:** this renders simple 3D *lines*, not extrusion-width volumes. Arc interpolation, true G-code simulation, layer feature coloring, full start/end-code state, wipe/retract semantics, speed/time coloring and desktop OrcaSlicer screenshot parity remain unimplemented. The test uses opt-in localhost with COOP/COEP, not an enabled production browser slicer.

## 2026-11-12: restricted process preset inheritance

The opt-in localhost Prepare test now resolves a **small Orca-style process preset chain** before applying overrides to the WASM engine. `scripts/process-preset-inheritance.mjs` accepts a locally selected bundle of explicitly named `process` presets, each with `inherits` and a `settings` object. It merges parent → descendant with child precedence, enforces a bounded graph, and rejects cycles, duplicate names, missing parents, prototype-pollution names, unsafe values, and any unrecognized options. The existing limited set of five numeric test process settings remains the ONLY supported set.

[Chrome CI #43248714956](https://github.com/temesotejam/layer-workbench/actions/runs/43248714956) **PASS**: synthetic three-level `Base → Fine → Strong Fine` settings were resolved and passed through `session.applyProfile("orca.native-json",...)`, resulting in G-code distinct from the earlier flat override fixture. Inheritance error unit tests and all existing 2D/3D G-code, multi-STL, transform, and browser engine tests also passed.

**Not full native OrcaSlicer presets:** vendor preset discovery, full profile file layouts, native inheritance dependencies, device compatibility, filament vector values, executable start/end G-code, path constraints, and real-machine print validation are not handled. This local subset is explicitly a developer acceptance gate, not a production printer profile manager. The published Pages site still does not bundle or autoexecute the WASM artifact.

## 2026-11-12: restricted raw Orca preset domains

OrcaSlicer's own profile organization distinguishes machine, filament, process and machine_model JSON plus vendor indices in `resources/profiles`. The localhost lab now supports a **restricted explicit collection of raw Orca-style machine/filament/process JSON records** supplied locally, not a complete vendor index auto-discovery. See `scripts/orca-profile-collection.mjs` and `scripts/test-orca-profile-collection.mjs`.

The importer resolves `inherits` within a matching type, detects cycles, missing and duplicate presets, uses child precedence, checks selected process/filament `compatible_printers` against the selected exact printer variant name, and reports unsupported fields. It forwards **only a safe numeric allowlist**: machine nozzle diameter and printable height, filament nozzle and bed temperatures, process layer height, wall loops, and infill density. All other real preset properties (including machine startup G-code) are ignored and separately listed as unsupported. It does not parse vendor index file paths, global filament library alias overrides, machine_model metadata, multi-extruder arrays or full official native preset inheritance/compatibility rules. It must not be used to print real objects.

[Chrome CI #43249816653](https://github.com/temesotejam/layer-workbench/actions/runs/43249816653) **PASS**: inheritance and compatibility unit tests plus real browser session init with restricted machine+filament values, process application through `session.applyProfile`, and distinct G-code for a two-STL plate. All earlier tests (3D toolpaths, 2D preview, process overrides, transformations and multi-object registration) remained passing.

**Next gate:** ingest pinned upstream vendor indexes and actual profile JSON files, implement global filament inheritance and per-printer alias precedence, validate settings schemas/vectors, and compare generated G-code to native OrcaSlicer v2.5.0 with the exact same full profile and mesh. Until those pass, this remains a developer proof only.

## 2026-11-12: indexed Orca vendor profile bundle acceptance

The localhost proof now recognizes an **indexed offline profile collection** in addition to its earlier flat `profiles` collection. The new `scripts/orca-vendor-index.mjs` validates a vendor index containing `machine_model_list`, `machine_list`, `filament_list`, and `process_list`, and resolves each relative `sub_path` against explicitly supplied in-memory files. It verifies exact indexed name/type correspondence, correct folder per type, duplicate/missing/unlisted records and unsafe traversal paths. Machine models remain metadata and are not forwarded to the slicer.

`scripts/orca-profile-collection.mjs` now accepts singleton-array numerical values used by many native machine and filament presets (but rejects unsupported multi-extruder arrays), and resolves inherited `compatible_printers` when the child omits it. The existing numeric allowlist remains deliberately restricted: the index loader is **not** a full native OrcaSlicer preset interpreter.

The local lab can use a JSON bundle shaped like `{ "vendor_index": {...}, "files": {"machine/...json": {...}, ...} }` with selected machine/filament/process names. Its files are selected by the user and stay in the browser; no arbitrary vendor paths are fetched, no binaries or unvalidated engine are published.

[Chrome CI #43250788956](https://github.com/temesotejam/layer-workbench/actions/runs/43250788956) **PASS**: vendor index unit tests (paths, registration, metadata, single-value vectors) plus an isolated real Chrome two-STL slice with indexed machine, filament and process settings produced G-code. All prior editor/2D+3D preview/profile tests passed.

**Caveat:** the test bundle consists of synthetic Orca-style fixture records matching the documented schema, *not an exhaustive import of actual shipped v2.5.0 vendor profile resources*. The next critical step is pinned upstream fixture ingestion with explicit licensing/provenance, exact vendor inheritance and alias resolution, typed multi-extruder settings, followed by native desktop vs WASM G-code parity testing.

## 2026-11-13: actual pinned upstream v2.5.0 filament profile verification

Introduced a **separate lightweight CI workflow** [Verify pinned real OrcaSlicer v2.5.0 profiles](../.github/workflows/verify-real-v250-profiles.yml). It downloads actual official `resources/profiles/OrcaFilamentLibrary.json` and three selected upstream JSON records directly from the immutable OrcaSlicer v2.5.0 source commit `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` inside the Actions runner. The upstream profile JSON files are **not copied into this repository, uploaded as artifacts or deployed to Pages**; fetch and SHA-256 audit logs retain provenance.

[Real upstream fixture run #43251997734](https://github.com/temesotejam/layer-workbench/actions/runs/43251997734) **PASS**. It verified the real vendor index entries and three-level inheritance
`fdm_filament_common → fdm_filament_pla → Generic PLA @System`, with supported `nozzle_temperature: 220`. The reader explicitly reports **67 other unsupported keys** in the combined official chain, including `hot_plate_temp` and `filament_flow_ratio` (which cannot be assumed equivalent to the generic bed temperature or ignored in a print-ready profile). An independent published source revision and per-file hashes are logged by CI.

Source and provenance:
- [Pinned official filament index](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/resources/profiles/OrcaFilamentLibrary.json)
- [Pinned common filament base](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/resources/profiles/OrcaFilamentLibrary/filament/base/fdm_filament_common.json)
- [Pinned PLA filament base](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/resources/profiles/OrcaFilamentLibrary/filament/base/fdm_filament_pla.json)
- [Pinned Generic PLA profile](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/resources/profiles/OrcaFilamentLibrary/filament/Generic%20PLA%20%40System.json)

The existing browser-integrated test still uses restricted fixture settings and is not ready to apply all native PLA settings. **Next:** verify actual machine/process and filament cross-bundle inheritance, carry over vector-valued parameters and selected plate temperatures correctly, then run same-fixture native desktop vs WebAssembly G-code comparisons. An isolated unit test accepting a small set of real source files is not feature parity with all vendor profiles.

## 2026-11-13: real pinned printer + filament + process chains

Extended the existing source-verified CI workflow to fetch the **actual v2.5.0 Creality vendor index** at commit `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` and six records (three machine, three process) alongside the previous official Generic PLA chain. The records are downloaded inside GitHub Actions only and not redistributed or added to the public site.

[Upstream real-profile run #43252945626](https://github.com/temesotejam/layer-workbench/actions/runs/43252945626) **PASS** for the original chains:
- Machine: `fdm_machine_common → fdm_creality_common → Creality CR-10 0.4 nozzle`. Supported resolved values: `nozzle_diameter=0.4`, `printable_height=400`.
- Process: `fdm_process_common → fdm_process_creality_common → 0.20mm Standard @Creality CR-10 0.4 nozzle`. Supported resolved values: `layer_height=0.2`, `wall_loops=2`, `sparse_infill_density=15`. The original source uses `15%`, so the reader now normalizes this official numeric percentage format.
- Filament: `fdm_filament_common → fdm_filament_pla → Generic PLA @System`; supported `nozzle_temperature=220`.
- Combined compatibility across **two real upstream vendor indices** (Creality plus OrcaFilamentLibrary) passed the selected exact printer name.

The audit reports **106 unsupported machine keys, 233 unsupported process keys and 67 unsupported filament keys** across these selected inheritance chains. These counts describe unsupported **distinct keys in the selected chain**, not missing files, and some are critical to actual printing. The test checks correct source/schema resolution, **not** native OrcaSlicer-vs-WASM G-code equivalence or physical printer safety. Full vendor inheritance, material/plate temperature mapping, scripts, speeds and nozzle vector semantics remain release blockers. `scripts/test-upstream-v250-creality.mjs` and `scripts/fetch-upstream-v250-fixture.py` are the reproducible audit.


## 2026-11-13: bounded XY arc G-code Preview

A real preview correctness gap was fixed in `scripts/gcode-preview-parser.mjs`. Previously, G2/G3 arcs were skipped **without updating the modal XYZE endpoint**, so the next linear move could start at the wrong location in both 2D and 3D displays. This could make a G-code preview materially misleading.

The isolated diagnostic now approximates common **G17 XY-plane G2/G3 I/J center arcs** with short line segments, including clockwise, counter-clockwise and full-circle paths, relative or explicit absolute arc-center coordinates, and inches-to-millimeters conversion. It rejects excessive arc tessellation (4096 subdivisions per arc; also bounded by the existing overall segment budget) and refuses to interpret `R` arcs, helical arcs, or non-XY plane arcs as drawn straight chords. Even when an arc is omitted, its XYZE endpoint advances so subsequent moves start at the right modal position; the preview reports both approximated and skipped arc counts. UI labels disclose these limitations.

[Isolated Chrome run #43269275536](https://github.com/temesotejam/layer-workbench/actions/runs/43269275536) **PASS** for the new parser regression tests and actual pinned WASM → G-code → layer and 3D preview integration. Earlier runs #43269073805 and #43269163897 failed because the legacy unit test still expected a now-rendered clockwise arc to be skipped. That expectation was corrected in `scripts/test-gcode-preview-parser.mjs`; no engine build or WASM artifact was modified.

This adds **diagnostic arc visualization, not native OrcaSlicer Preview parity**. R-center calculations, G18/G19, helices, speed/acceleration, tool changes, extrusion widths and firmware-specific macros remain unsupported; generated G-code remains unapproved for actual printing.

## 2026-11-13: explicit hot-plate temperature mapping in isolated WASM lab

Real pinned `OrcaFilamentLibrary` profiles do **not** use generic `bed_temperature` as a substitute for plate-specific temperatures. The previous restricted importer could read `nozzle_temperature` but did not handle `hot_plate_temp`. In the localhost-only Prepare WASM lab an explicit **“Orca hot plate only”** selection can now resolve the nearest inherited `hot_plate_temp` from the chosen filament record and map it into the generic **test** `bed_temperature` configuration; the default **does not change** until explicitly selected.

The parser validates the selected value is a single finite scalar in its restricted 0–120 °C test range, rejects missing/multi-extruder/out-of-range values, and reports provenance through `filament.selectedBed`. The mapped key is no longer listed as unsupported **only when explicitly selected**. The initial-layer `hot_plate_temp_initial_layer`, other plate types, airflow, volumetric speeds, flow ratio, and native multi-extruder semantics remain unsupported; this mapping alone does **not** make full printer profiles usable or G-code safe.

Validation:
- [Pinned source and unit check #43279795731](https://github.com/temesotejam/layer-workbench/actions/runs/43279795731) **PASS**: actual v2.5.0 PLA base profile supplies inherited `hot_plate_temp = 55` for `Generic PLA @System`; tests verify no implicit mapping, missing/invalid/multi-value rejection, and a fake one-slicer-api session receiving the explicitly selected bed temperature.
- [Real isolated Chrome WASM test #43279766346](https://github.com/temesotejam/layer-workbench/actions/runs/43279766346) **PASS**: a local synthetic filament collection with inherited `hot_plate_temp = 65` produced a different actual WASM G-code SHA-256 **only after** explicitly selecting the hot plate, compared with its prior default `bed_temperature = 55`. All prior native browser transform, two-model slice, process inheritance and G-code Preview checks also passed.

Changes: `scripts/orca-profile-collection.mjs`, `scripts/orca-vendor-index.mjs`, `scripts/prepare-engine-lab.mjs`, `scripts/test-orca-profile-collection.mjs`, `scripts/test-hot-plate-bridge.mjs`, `scripts/test-upstream-v250-profiles.mjs`, `scripts/test-engine-probe.mjs` and the pinned-profile CI workflow. **Still not proof of correct native desktop parity**: required future steps include initial-layer bed and nozzle temperature semantics, all plate types, material flow and speed limits, complete startup/shutdown scripts, multi-extruder vector mapping, and same-full-profile G-code comparisons.
