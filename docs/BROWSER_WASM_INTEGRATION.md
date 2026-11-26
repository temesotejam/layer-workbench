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

## 2026-11-13: actual first-layer hot-plate heater command check

The opt-in localhost plate importer now recognizes the inherited official `hot_plate_temp_initial_layer` vector as distinct from `hot_plate_temp`. It requires a single safe numeric value and rejects invalid/out-of-range/multi-extruder values. The initial temperature is **never inferred** when an upstream field is missing, and no plate-specific fields are forwarded in the default unselected mode.

This check uncovered an important trap: **changing a config key or a G-code hash is not sufficient to prove that bed-heating commands changed.** In official v2.5.0, `PrintConfig.cpp` selects the active `curr_bed_type` (the High Temp Plate variant has `hot_plate_temp` and `hot_plate_temp_initial_layer`), and `GCode.cpp::_print_first_layer_bed_temperature` uses that selected plate to emit heater commands. Therefore an explicit hot-plate choice forwards `curr_bed_type="High Temp Plate"` and native single-filament arrays for both hot-bed temperatures; the restricted compatibility `bed_temperature` also remains in the test config.

[Real Chrome WASM CI #43288582338](https://github.com/temesotejam/layer-workbench/actions/runs/43288582338) **PASS**: holding the steady hot-plate temperature at **65 °C** while changing only the first-layer value **75 → 85 °C** changed the *actual heater commands*, not just G-code comments or file hashes:

| First-layer preset | Emitted initial heater command | Emitted later steady-bed command |
| --- | --- | --- |
| 75 °C | `M190 S75 ; set bed temperature and wait for it to be reached` | `M140 S65 ; set bed temperature` |
| 85 °C | `M190 S85 ; set bed temperature and wait for it to be reached` | `M140 S65 ; set bed temperature` |

The older separate real-source [profile verification #43288371612](https://github.com/temesotejam/layer-workbench/actions/runs/43288371612) also **PASS** and confirms that the pinned official Generic PLA base contains `hot_plate_temp = ["55"]` and `hot_plate_temp_initial_layer = ["55"]`. The test includes malformed vectors and ensures no active-plate mapping without explicit selection. Source files are fetched only on CI runners and not published.

**Important limitations:** This proves a narrow, local, opt-in native heater-command effect for a synthetic controlled WASM fixture—not correct printer start/end scripts or the entire real vendor profile, and **not** safe real-printer output. Other plate types, native nozzle-first-layer behavior, volumetric speed, material flow ratio and multi-extruder semantics remain unsupported. Exact native desktop vs WASM G-code parity is still unverified.

## 2026-11-13: actual first-layer nozzle heater-command check

The restricted localhost profile importer now resolves the official `nozzle_temperature_initial_layer` through the filament inheritance chain and preserves it as a **single-filament native string vector**, independently of steady `nozzle_temperature`. It rejects invalid, out-of-range and multi-extruder values rather than silently reducing them. The pinned official v2.5.0 `fdm_filament_pla` supplies 220 °C for both initial and steady nozzle temperatures. The pinned-profile CI passes the real-source inheritance assertions, and a fake session test proves native vector forwarding to `session.init`.

**Actual WASM heater commands, not just metadata:** [isolated Chrome test #43294947915](https://github.com/temesotejam/layer-workbench/actions/runs/43294947915) **PASS**. A synthetic locally uploaded filament collection uses a first-layer nozzle temperature of 235 °C with 215 °C steady; changing **only** the first-layer value to 245 °C in the same two-STL print changes the G-code as follows:

| Heater command in actual WASM G-code | Before | After |
| --- | --- | --- |
| Initial nozzle heater | `M104 S235 ; set nozzle temperature` | `M104 S245 ; set nozzle temperature` |
| Later steady nozzle heater | `M104 S215 ; set nozzle temperature` | `M104 S215 ; set nozzle temperature` |
| Shutdown | `M104 S0 ; turn off temperature` | `M104 S0 ; turn off temperature` |

An earlier test falsely reported empty heater-command arrays because its **test regex had double-escaped backslashes**, matching literal `\\n` rather than G-code newlines. The corrected expression matched real lines and the same test passed. The browser test is strengthened to assert exact initial and steady M104 values so a future change cannot pass on hashes or header comments alone.

**Still incomplete:** This shows M104 behavior for a controlled generic fixture in isolated Chrome; it does not establish M109 waits, full manufacturer start/end G-code semantics, a complete native preset import, paired native desktop-versus-WASM G-code equivalence, or real-printer safety. No executable manufacturer startup scripts or unverified engine binaries were added to the public site. These remain future acceptance gates.

## 2026-11-13: native single-filament flow ratio changes real extrusion G-code

The local-only Orca profile importer now resolves `filament_flow_ratio` from the nearest source in the selected filament inheritance chain and forwards a **one-element native string vector**, not a scalar percentage. The value is accepted only if finite and in the deliberately restricted **0.5–1.5 diagnostic range**. Missing values are left unspecified; multi-element vectors, invalid values and out-of-range values fail closed. The mapping does not automatically enable print-ready output or change any published engine artifact.

The [pinned official v2.5.0 profile CI #43309781628](https://github.com/temesotejam/layer-workbench/actions/runs/43309781628) **PASS** verified that `Generic PLA @System` inherits `filament_flow_ratio = ["0.98"]` from the official PLA base. The same file has a **six-element** `filament_max_volumetric_speed` override (`["12","21","40","12","21","30"]`); this cannot safely be interpreted as a single extruder speed limit, so that separate parameter **remains unsupported**. The current pinned three-level filament chain reports **65 unsupported unique field keys** with the newly supported first-layer temperature and ratio mapping; machine and process remain **106 / 233** respectively.

The [isolated Chrome actual-WASM CI #43310060809](https://github.com/temesotejam/layer-workbench/actions/runs/43310060809) **PASS** sliced the same two-STL fixture twice, changing **only** the inherited native flow ratio from **0.80 to 1.20**. We compared numeric `E` parameters on the actual generated `G1` XY extrusion moves—not file hashes or config comments. All first 120 sampled XY extrusion `E` values differed. The first sampled value was **2.62288 → 3.53432** (absolute extruder positions also reflect preceding moves, so their ratio alone is not a direct calibrated material-flow measurement). Local fake-engine testing additionally confirms that the native one-element vector arrives in `session.init`. The first #43309855113 Chrome attempt failed because the test regex matched literal backslashes instead of real G-code line breaks; [commit `4c06e6b`](https://github.com/temesotejam/layer-workbench/commit/4c06e6b08fee415d08f67341a9304318a30c2dd1) corrected it, and the final browser run passed.

**Not established:** full flow calibration parity with official desktop, six-value maximum volumetric speed semantics, per-printer nozzle/material limits, multi-extruder material dispatch, firmware-specific scripts, native-vs-WASM exact G-code equivalence or real-machine safety. This remains an isolated development bridge only.

## 2026-11-13: explicit extruder-variant maximum volumetric speed

Official pinned v2.5.0 Generic PLA @System contains six variant names:
Direct Drive Standard, Direct Drive High Flow, Direct Drive Extra High Flow,
Bowden Standard, Bowden High Flow, Bowden Extra High Flow. The corresponding
`filament_max_volumetric_speed` values are `[12,21,40,12,21,30]` mm³/s.
Pinned OrcaSlicer source `ParameterUtils.cpp` resolves this option using
`filament_extruder_variant`, **not** a six-filament mapping.

The opt-in localhost test accepts an exact manual variant name and forwards
only its validated one-element native speed vector. For a multi-value vector,
no selected variant means **unsupported**, not the first value. Mismatched
lengths, duplicate names, unknown choices and out-of-range values reject.
Single-value profile limits are supported as one-filament native vectors.

Tests cover the official pinned index, parser validation and session.init
forwarding. A bounded two-model isolated Chrome test has now verified **actual G-code**
feedrate response, not just config JSON, metadata or output hashes.
[Chrome CI #43315594359](https://github.com/temesotejam/layer-workbench/actions/runs/43315594359)
**PASS** at commit `619f75a`: explicit variant settings of 0.7 vs 40 mm³/s
produced 9,883 comparable XY+E moves in each run. Median modal G1 feedrate
was **644.409 vs 6000 mm/min** (max 758.106 vs 6000 mm/min).
These are intentionally extreme synthetic diagnostic limits, **not** approved
material settings. Actual printer/nozzle variant compatibility and full
native G-code parity remain unverified; never print this test G-code.

## 2026-11-13: bounded signed-R G2/G3 Preview geometry

The isolated local Preview now approximates common G17 XY-plane G2/G3 **R-radius** arcs as bounded line segments. Positive R chooses a minor (up to 180°) arc and negative R selects the major (over 180°) arc, for both clockwise and counter-clockwise motion. Radius units follow G20/G21. A semicircle with positive R is supported; ambiguous negative-R semicircles, coincident endpoints, impossible radii, simultaneous R and I/J, helices, and non-XY planes are **not** drawn. They still update modal XYZE endpoint state so subsequent moves do not jump back. The existing 4096-subdivision and global segment budgets still apply.

The dedicated parser regression adds minor/major and clockwise paths, semicircle, imperial units, invalid/ambiguous geometry, skipped-arc endpoint safety and budget enforcement. This is a **diagnostic visualization** only, not firmware-exact motion simulation, G-code parity with native OrcaSlicer, or print safety validation. The unchanged archived WASM engine binary is not republished to the public site.


## 2026-11-13: pinned process top/bottom shell counts

The restricted Orca profile resolver now accepts bounded integer `top_shell_layers`
and `bottom_shell_layers` (0–12), including inherited values and child overrides.
These are already allowed by the local bridge's restricted process override
validator; all other unsupported process keys remain excluded. The official
OrcaSlicer v2.5.0 pinned Creality CR-10 0.4 nozzle / 0.20mm Standard process
sets **5 top** and **4 bottom** shell layers. This was checked against the
upstream revision `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`,
without committing any upstream preset JSON.

[Real pinned profiles CI #43346379703](https://github.com/temesotejam/layer-workbench/actions/runs/43346379703)
passed with assertions for both settings; [isolated Chrome CI #43346460808](https://github.com/temesotejam/layer-workbench/actions/runs/43346460808)
passed with a real WASM slice demonstrating that a local inherited solid-shell
override changes **G-code motion commands** (comments excluded). This is an
integration proof for two additional native process options, **not** a full
native-versus-WASM paired G-code parity result. Do not print the generic-PLA
fixture G-code on a physical printer.

## 2026-11-13: multi-vendor profile catalog foundation

Added `scripts/orca-vendor-catalog.mjs` as a catalog layer over the existing strict single-vendor index reader. It accepts multiple independently supplied vendor index/file bundles, validates each with the existing path/name/type checks, and preserves a separate vendor namespace for every bundle. It deliberately does **not** merge common profile names across vendors: identical names may carry different machine geometry, firmware, nozzle and startup semantics. A caller must select a vendor namespace before resolving its machine/filament/process chain. CI tests cover duplicate vendor rejection and same-name/different-value isolation.

This is the foundation for broad printer coverage, not yet an automatic download/import of every upstream vendor. The current production UI and WASM profile bridge still support only a restricted setting allowlist. Full multi-vendor support requires catalog discovery, machine-model/variant selection, per-vendor compatibility, global filament library alias precedence, multi-extruder vectors, and printer-specific start/end G-code semantics. Official upstream profile data remains CI/local supplied; do not redistribute it without reviewing upstream license terms.

## 2026-11-13: global filament fallback and printer-specific alias precedence

Extended the multi-vendor catalog with explicit filament alias selection. A vendor-specific filament preset whose alias matches the requested material and whose `compatible_printers` contains the selected exact printer variant takes precedence over the global `OrcaFilamentLibrary` `@System` preset. If no compatible vendor-specific replacement exists, the global preset is selected. Multiple matching vendor-specific candidates or missing global fallback are rejected as ambiguous/missing instead of choosing arbitrarily. The implementation reads Orca's native `compatible_printers` field and keeps the vendor namespace intact.

This follows the upstream profile documentation's distinction between inheritance and compatibility, and its printer-specific filament replacement rule. Current tests use synthetic bundles; they do not yet prove the full Snapmaker U1 four-tool chain or all upstream vendor profiles. See the [OrcaSlicer profile authoring documentation](https://github.com/OrcaSlicer/OrcaSlicer/wiki/how_to_create_profiles). The next step is to fetch pinned Snapmaker vendor and global filament index/profile records inside CI, then validate all four tool slots, filament IDs, nozzle variants and machine-specific G-code before applying them to WASM.

## 2026-11-13: pinned official multi-vendor fixture verified in CI

[Real pinned profile CI #43358211132](https://github.com/temesotejam/layer-workbench/actions/runs/43358211132) **PASS** at commit [`d2dc5ee`](https://github.com/temesotejam/layer-workbench/commit/d2dc5ee6dc5bb794fbb048ea397568ccf8c34658). The new `scripts/fetch-upstream-v250-multi-vendor-fixture.py` fetches a narrow, exact-name selection of official Snapmaker U1 (0.4 nozzle) and Prusa MK4S (0.4 nozzle) machine-model, machine, process and filament records from pinned official commit `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`. JSON remains **on the CI runner only**. The test combines these with the pinned official `OrcaFilamentLibrary` Generic PLA chain.

`scripts/test-upstream-v250-multi-vendor.mjs` verifies actual vendor namespaces, matching machine/model/process entries, Prusa `Generic PLA @Prusa MK4S` selection for the exact `Prusa MK4S 0.4 nozzle` variant, and `Generic PLA @System` fallback for the Snapmaker U1 variant. It verifies the native Snapmaker U1 `nozzle_diameter` vector has **four** 0.4-mm values and keeps native machine startup G-code as **unexecuted source data**, not generic one-nozzle settings. The failing catalog test from the preceding commit #43352741058 was caused by a literal `\\n` escape before `console.log`, fixed in `1ddfddab`; the profile CI #43357879974 passed before this additional real-profile fixture was introduced.

**Limitations:** these are leaf records, not complete resolved multi-level Snapmaker and Prusa inheritance chains, and no four-tool print settings are forwarded into the WASM engine. Printer-dependent scripts and vendor data must not be executed or used for printing. This is profile-selection evidence, not feature/UI/3MF parity or G-code equivalence. Next: recursively fetch/verify the exact named inheritance ancestors and handle multi-extruder option vectors without coercing them to a scalar.

## 2026-11-13: pinned Snapmaker/Prusa **complete indexed inheritance chains** (CI verified)

The multi-vendor CI fixture now walks each selected machine, filament and process preset's `inherits` references **recursively, within the same vendor and index section**, from root to leaf. It rejects absent/ambiguous or cyclic ancestors, mismatched profile name/type, excessive recursion and non-indexed paths. It retrieves only an explicitly selected narrow set of official v2.5.0 JSON files at pinned commit `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, prints source hashes, and keeps the resulting JSON confined to the runner.

[Real upstream CI #43360847102](https://github.com/temesotejam/layer-workbench/actions/runs/43360847102) **PASS** at commit `efeb477`: each vendor fixture now contains **11 indexed records** (one machine model plus complete machine/filament/process roots and leaves), up from four leaf records. Tests assert every parent link is a real indexed record. Notably:

- **Snapmaker U1** machine: `fdm_klipper → fdm_toolchanger → fdm_U1 → Snapmaker U1 (0.4 nozzle)`; filament: `Snapmaker PLA Basic @U1 base → Snapmaker PLA Basic @U1`; process: `fdm_process_U1 → fdm_process_U1_common → fdm_process_U1_0.20 → 0.20 Standard @Snapmaker U1 (0.4 nozzle)`.
- **Prusa MK4S** machine: `fdm_machine_common → fdm_machine_common_nextruder → fdm_machine_common_mk4s → Prusa MK4S 0.4 nozzle`; filament: `fdm_filament_common → fdm_filament_pla → Generic PLA @Prusa MK4S`; process: `fdm_process_common → process_common_mk4s → 0.20mm STRUCTURAL @MK4S 0.4`.

The restricted one-nozzle config importer is explicitly tested to **reject** Snapmaker's four-nozzle machine vector instead of silently selecting a single extruder. This is a successful **source inheritance and safety-gate** test, not evidence that WASM can consume the full four-tool setup or that G-code matches native desktop output. Next: implement validated per-extruder vector handling and a source-preserving full-option inheritance model before enabling any printer-specific startup scripts.

## 2026-11-13: source-preserving complete option inheritance (inspection only)

Added `scripts/orca-full-profile.mjs`, a separate non-executable resolver for
indexed machine/filament/process records. It retains every inherited option,
including unknown keys, script strings and whole per-tool vectors. A child
option replaces the parent option without concatenating vectors or selecting
element zero. The result retains `sourceByKey` provenance and
`usableForPrinting:false`. `inspectOrcaNozzleVector` reports all resolved
nozzle diameters and tool count without applying them to the WASM adapter.

The synthetic test `scripts/test-orca-full-profile.mjs` checks four-nozzle
inheritance, option provenance, unmodified input, nested JSON values,
missing/cyclic inheritance, duplicates, unsafe keys, invalid numbers and bad
nozzle vectors. The pinned real-vendor CI additionally checks Snapmaker U1's
four 0.4-mm nozzles and preserves `machine_start_gcode` as DATA only; Prusa
MK4S should resolve a single nozzle. These real-source assertions require
a successful CI run before being described as verified.

Not implemented: passing four-tool settings into OrcaWasm PrintConfig,
checking all native option types and vector lengths, interpreting machine
startup scripts, tool changes, offsets, wipe towers, or printer-safe G-code.
The existing restricted one-tool importer still rejects the U1 vector.
The source-only resolver is not connected to the public UI or WASM.
Next: validated tool/filament vector schema and same-profile native/WASM
G-code comparison.

## 2026-11-13: audit inherited array-shaped options for multi-tool printers

Added `inspectOrcaArraySettings` to the source-preserving resolver. It inventories every inherited array-valued setting, its length and source profile, and marks arrays whose length happens to equal the nozzle count as **possible** per-tool vectors. This is deliberately an inspection report only: array length alone cannot establish the native ConfigDef semantics, because compatibility lists, temperature tables and other non-tool arrays can have the same length. The real pinned Snapmaker U1 CI test now emits this inventory and asserts only that the four-element nozzle vector is retained. No array is forwarded to PrintConfig on the basis of this heuristic.

## 2026-11-13: array semantics classified from pinned native ConfigDef sets

The earlier array-length inventory only identified candidates. Added `scripts/orca-config-array-semantics.mjs`, transcribed from the exact pinned v2.5.0 `src/libslic3r/PrintConfig.cpp` sets at `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`: `printer_extruder_options`, `printer_options_with_variant_1`, `printer_options_with_variant_2`, and `filament_extruder_override_keys` plus the explicit extra keys in `is_filament_extruder_override_key`. The full-profile array audit now annotates known arrays with these native classifications and source provenance. Unknown arrays remain unclassified; matching the nozzle count is informational only.

This is materially safer than inferring semantics from array length. It still does not validate every option's ConfigDef storage type, cardinality, or runtime use, and does not forward any multi-tool vector into the WASM PrintConfig. The Snapmaker U1 startup/change-tool G-code remains inert data. The dedicated test is registered in the pinned real-profile CI.

## 2026-11-13: explicit 1-based filament-to-extruder routing inspection

Added `scripts/orca-filament-routing.mjs` and its dedicated unit test. In the pinned official `src/libslic3r/PrintConfig.cpp`, `filament_map` is `coInts` and `get_extruder_index` reads `filament_map.get_at(filament_id) - 1`. The inspector requires an **explicit** map: each filament slot's 1-based extruder ID must be an integer in `1..nozzle_count`; a value outside the machine's nozzle count, invalid numeric strings, empty or sparse arrays, and oversized maps are rejected. Duplicate extruder IDs are preserved. For transparency, the report includes both the 1-based native ID and 0-based array index, along with that nozzle's diameter.

The real pinned Snapmaker U1 fixture test now exercises a **synthetic explicitly supplied four-filament map** against its actual four-nozzle metadata, without claiming that this routing appears in the printer preset. This remains an inspection-only, non-executable data check (`usableForPrinting:false`). The source machine preset does **not** supply a verified full four-filament routing here, and the helper does not silently infer one from four nozzles. No filament compatibility, printer offsets, scripts, native G-code output, multi-tool WASM bridge, or printer safety is implied. The test is registered in the pinned-real-profile CI.

## 2026-11-13: source-only U1/Prusa filament temperature and flow vector audit

Added `scripts/orca-filament-material-inspection.mjs` (and `test-orca-filament-material-inspection.mjs`) to inspect the five upstream material keys `nozzle_temperature`, `nozzle_temperature_initial_layer`, `filament_flow_ratio`, `filament_max_volumetric_speed`, and `filament_diameter`. Their pinned native `src/libslic3r/PrintConfig.cpp` ConfigDef types are `coInts` (both temperatures) and `coFloats` (ratio nullable, volumetric speed and diameter). The audit records each inherited key's source, scalar/array shape, raw value and parsed numeric values without modifying the original record or dispatching a temperature/G-code command.

The real pinned Snapmaker U1 `Snapmaker PLA Basic @U1` has two entries for temperature, flow ratio, and maximum volumetric flow but only one for filament diameter; its original mixed vector lengths are preserved. A pinned Prusa MK4S leaf uses the scalar string `"230"` for `nozzle_temperature_initial_layer` despite the native `coInts` option definition. The inspection reports that scalar shape explicitly and **never auto-broadcasts it to tools**. Strict numeric parsing rejects non-finite values, invalid integers, missing array elements and invalid nonpositive flow, diameter or volumetric speed; `nil` is retained only as an unresolved nullable flow-ratio entry. This is not evidence that either preset can be applied to WASM or to an actual printer, nor that any material entry selects a physical nozzle or hotend variant. A separate explicit `filament_map` inspection remains required and is still not sufficient for native routing semantics. The pinned real-profile CI now exercises the two actual vendor shapes plus local invalid-input cases.

## 2026-11-13: keep filament routing separate from native filament-variant resolution

Pinned v2.5.0 source inspection of `PresetBundle.cpp` and `test_config_variant_expansion.cpp` shows that native filament variant selection is not a direct lookup by `filament_map`. `PresetBundle::get_filament_variant_index` reads the physical extruder's `extruder_type` and calls `get_index_for_extruder(..., "filament_extruder_variant")` with the selected `NozzleVolumeType`. Native tests show that a hybrid nozzle can expose Standard and High Flow slots, and that Bowden/Direct Drive plus Standard/High Flow affect the selected variant. They also show a Snapmaker-U1-style four-nozzle printer with no `extruder_variant_list` can still report no different-extruder variants. Therefore nozzle count, filament count, and variant count are distinct.

Added `scripts/orca-variant-input-inspection.mjs` and tests. It inventories the relevant machine and filament inputs and explicitly returns `selectedVariantIndex:null`; it does not reproduce the native resolver or forward values to WASM. The pinned real U1 test instead records four literal `extruder_variant_list` strings (`Direct Drive Standard,Direct Drive High Flow`); the inspected `extruder_type` is absent. It still makes no claim about a selected variant or printable configuration. The remaining native resolver details, nozzle-volume statistics and filament self-index handling must be ported and tested against the upstream C++ test cases before any WASM integration.

## 2026-11-13: batch implementation of native filament variant slot lookup

Added `scripts/orca-variant-slot-resolver.mjs` with a conservative port of the native variant-slot lookup contract documented in pinned `PrintConfig.hpp` and exercised by `tests/libslic3r/test_config_variant_expansion.cpp`. It resolves (1-based extruder ID, extruder type, nozzle volume type) to a variant string such as `Direct Drive High Flow`, finds the exact matching slot for that ID, falls back to that ID's first variant, and uses slot zero when that ID has no variant. Hybrid is rejected as a physical preset variant. The regression suite mirrors the upstream standard/high-flow, Direct Drive/Bowden, missing-ID and shorter-variant-list cases and is registered in the pinned profile workflow.

Scope remains metadata-only: this does not port `DynamicPrintConfig::update_values_to_printer_extruders`, nozzle-volume statistics expansion, filament self-indexing, nil override application, multi-tool WASM PrintConfig conversion, tool-change G-code or wipe-tower generation. The resolver returns `usableForPrinting:false`; it must not be used to generate printer-ready output. In particular, Snapmaker U1's real pinned profile contains four comma-delimited variant strings, while this inspector does not resolve the missing `extruder_type`; its four equal nozzles cannot be used to infer a selected material slot. A true U1 multi-tool implementation still requires native source parity for those remaining stages and an engine-level test.

## 2026-11-13: tool-selector-aware local 2D/3D G-code preview

The isolated development Preview now preserves explicit `T0..T255` selectors as **diagnostic labels** on each parsed G0/G1/G2/G3 line segment. The parser exposes sorted `selectedToolIds`, per-selector extrusion segment counts, and `segment.toolId` for both line and tessellated XY arc segments. Large reserved/vendor selector values such as `T1000` are not treated as ordinary tool labels. Existing no-selector and single-selector paths retain the orange extrusion styling; when multiple selectors are present, both local 2D and 3D preview surfaces use the same deterministic selector palette. No actual filament RGB, AMS slot-to-tool relationship, or number of physical nozzles is inferred from `T` labels.

The parser's existing regression suite now checks `T0/T3/T2` transitions, the `T1000` guard, per-tool segment counts, unknown/unselected labels, and palette separation; the Chrome workflow also syntax-checks both preview modules and runs these parser tests. This is a visualization/diagnostic addition only. The preview is opt-in and isolated to the local engine lab, is not equivalent to the native OrcaSlicer Preview, and is not a validated G-code interpreter or print safety check. The already-built WASM engine is unchanged.

### X1E vendor unload sentinel correction

Inspection of the user-supplied X1E-style G-code found regular `T0`/`T3` selectors alongside reserved `T1000`/`T1100` commands and a final `M620 S255 → T255 → M621 S255` filament-unload sequence. The diagnostic renderer now treats `T255` as clearing the currently labeled tool, not selecting a 256th physical nozzle/material. It never infers that `T0` or `T3` are physical nozzle numbers. The raw user G-code stays outside the repository. A small synthetic regression checks the reset behavior; this is not a universal firmware implementation.

## 2026-11-13: native 3MF export/import in isolated Chrome; capability gap confirmed

[Isolated Chrome CI #43407690338](https://github.com/temesotejam/layer-workbench/actions/runs/43407690338) **PASS** for the pinned v2.5.0 candidate. The new `scripts/test-browser-3mf-roundtrip.mjs` uses the **actual browser-loaded WASM API** and a bounded synthetic 12-triangle STL. It constructs a native session, exports `project.3mf`, opens that archive in a second native session with `initProfile("project.3mf", bytes)`, checks a one-instance manifest, converts the archive back into a 12-triangle binary STL through `threeMfToStl`, and performs an untouched `preservation:"require"` re-export. The re-export is byte-for-byte identical; the existing Python 3MF member comparator also passes with `--scope all`. The raw browser output and JSON reports are available as ephemeral CI artifacts. No original user 3MF or printer-specific G-code is committed.

A meaningful gap was discovered in the **first FAILED browser runs #43407413997/#43407451517**: `session.getPreview(meshId)` returns `UNSUPPORTED` with `OrcaSlicer does not implement mapped STEP previews` for this candidate. The test was corrected to verify *flattened geometry conversion* separately and record `mappedPreviewSupported:false`; it does **not** mislabel that conversion as a mapped/face-ID render preview. This means the native-3MF-to-editable-WebGL vertical slice is **not** complete. Desktop-created project import, semantic metadata preservation after an edit, instance transform round-trip and desktop reopen have not been demonstrated.

## 2026-11-13: native variant lookup CI corrections

Pinned `PrintConfig.cpp::find_variant_index` returns an exact variant for a matching 1-based ID, else the **first** variant belonging to that ID, else `-1`. Only `get_config_index_base` clamps the resulting `-1` to zero. The initial JS port mistakenly treated two variants of the same ID as ambiguous, causing [profile CI #43390845126](https://github.com/temesotejam/layer-workbench/actions/runs/43390845126) to fail. The corrected resolver follows the pinned native loop, including empty-ID and any-ID semantics, and adds regression tests. The subsequently unmasked U1 real-fixture failure came from expecting `extruder_variant_list:null` despite actual inherited four-string values. That regression assertion was corrected. [Profile CI #43408017939](https://github.com/temesotejam/layer-workbench/actions/runs/43408017939) **PASS**. This remains source-only metadata inspection, not multi-tool WASM printing.

## 2026-11-15: explicit six-bed selector in localhost Prepare (v2.5.0)

The `?engineLab=1` **localhost-only**, cross-origin-isolated Prepare proof now exposes the six native v2.5.0 `curr_bed_type` choices: Cool, Engineering, High Temp, Textured PEI, Textured Cool and Supertack. Selection remains explicit; the default **none** still forwards no native plate key. The selected inherited filament temperature and optional first-layer temperature retain the native per-filament vector keys; zero/unsupported values fail closed. This only extends the opt-in development UI, not published Pages, and does not infer a printer-compatible plate.

[Isolated Chrome PR #12 run #43670658987](https://github.com/temesotejam/layer-workbench/actions/runs/43670658987) **PASS** using the pinned previously validated v2.5.0 multithreaded WASM candidate. For a *synthetic test profile*, explicit **Textured PEI** selection resulted in actual G-code heater instructions `M190 S70` (first layer) and `M140 S50` (other layers). The preceding hot-plate fixture produced `M190 S85` and `M140 S65`; the test compares heater commands themselves instead of relying on G-code hashes or metadata. Existing STL, 3MF, preview and profile integration gates remained PASS.

The only tested new physical G-code behavior is this controlled textured-plate example; the other plate selections have source-pinned parser/forwarding checks, **not** complete native/desktop heater-command parity tests. No real-printer material compatibility, startup scripts, full-profile parity, or print safety is established. Do not use the generated test G-code for printing.


## 2026-11-15: experimental OBJ mesh import through isolated WASM lab

The localhost-only Prepare lab now accepts an OBJ file already visible in the Three.js viewport, converts its face-fan triangles to binary STL locally (scripts/obj-to-stl.mjs), and supplies that geometry and the displayed root transform to the existing one-slicer-api STL project bridge. This is separate from the public static page: the standard site still has no production slicer.

Safety/semantic boundaries: OBJ coordinates are assumed millimeters; UVs, materials, vertex colors, groups and non-mesh primitives are not copied to STL. The conversion rejects missing faces, invalid indices, nonfinite/degenerate triangles, invalid vertex layouts and excessive text/triangle counts. It does not validate watertightness or guarantee that arbitrary CAD/OBJ semantics reproduce the desktop. Source files are not uploaded. STEP/STP files remain unsupported; they require a separately verified CAD tessellator and should not be relabeled as OBJ/STL. Generated G-code is test-only and must not be printed without independent machine/profile validation.

Acceptance: node scripts/test-obj-to-stl.mjs checks bounding, triangle counts, face indices, malformed and degenerate geometry; scripts/test-engine-probe.mjs exercises the complete OBJ import -> localhost conversion -> actual isolated Chrome/WASM G-code flow and checks multiple deposited layers. A green gate establishes only that narrow fixture, not native v2.5.0 vs WASM G-code parity or 3MF semantic compatibility.


## 2026-11-15: preserve true Z endpoints in local 3D G-code diagnostics

Previously the local 3D G-code line preview used the destination layer Z for **both** endpoints of every G0/G1 segment. A pure Z travel move became a zero-length horizontal line and a simultaneous XY+Z move appeared level even though its true trajectory is sloped. The bounded parser now stores `z1` and `z2` (millimeters) for each linear or planar arc segment. The 3D renderer consumes these individual heights, while the existing 2D per-layer grouping still uses the destination Z. A standalone pure Node test covers vertical travel, sloped extrusion, relative/inch coordinates and malformed values; a lightweight CI workflow runs without downloading or rebuilding the 30 MB WASM candidate.

**Scope:** this improves only geometry visualization in the explicit localhost-isolated lab; it does not handle helical arcs, printer firmware motion planning, native desktop parity, or the public Pages slicer. Neither toolpaths nor preview assert that a G-code file is safe for a real printer.

## 2026-11-15: bounded G17 helical arcs in localhost G-code diagnostics

The opt-in localhost-only G-code preview tessellates valid G17 XY circular arcs
that also change Z, including relative-Z moves and I/J full-circle helices.
Each short 3D line segment interpolates Z between the commanded endpoints;
all tessellated pieces of one arc remain grouped under the destination Z for
the existing 2D layer selector. Existing 4096-segment-per-arc and overall
preview-budget limits still apply. Invalid radii and non-XY-plane arcs are
skipped while preserving their modal endpoint for later motions. Regression
tests check rising arcs, full circles, R arcs, relative coordinates, 3D
continuity, and unsupported-plane fallback.

This is diagnostic visualization, **not** complete firmware interpolation,
OrcaSlicer native Preview parity, G-code parity, print-ready output, or a
publicly enabled slicer. Helix pitch is approximated by linear Z interpolation
along the arc. The previously validated WASM engine candidate is unchanged.


## 2026-11-15: pinned Creality v2.5.0 process deposition-speed coverage

The localhost-only restricted real-profile adapter now accepts four additional
independent **absolute mm/s** process keys: `sparse_infill_speed`,
`internal_solid_infill_speed`, `top_surface_speed` and
`gap_infill_speed`. Each remains bounded (1–800 mm/s for diagnostic input),
single-valued, and independently inherited/overridden. Relative percentages,
multi-extruder vectors and invalid values fail closed instead of being silently
converted to absolute speed. The source-pinned
`0.20mm Standard @Creality CR-10 0.4 nozzle` fixture checks resolved values
50 / 50 / 30 / 30 mm/s, as shipped at upstream
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`.
These tests validate JSON selection and native-key forwarding boundaries;
they **do not** demonstrate that the WASM-produced G-code travels at those
speeds, native-vs-WASM toolpath equality or physical printer suitability.
Other process keys (including relative speed parameters) remain unsupported.
Public Pages and the WASM engine artifact are unchanged.

## 2026-11-15: pinned process deposition-speed bridge allow-list alignment

The source-pinned v2.5.0 profile reader already resolved `sparse_infill_speed`,
`internal_solid_infill_speed`, `top_surface_speed`, and `gap_infill_speed`
for the Creality CR-10 0.20mm process. The localhost slicer path subsequently
revalidated `nativeCollection.process.settings` through a separate
`parseTestProcessOverrides()` allow-list which lacked these four keys. This
caused a local slice to fail even though raw profile inheritance tests passed.
The bounded process override allow-list now admits those four *absolute mm/s*
values with the same [1, 800] diagnostic limits. Relative percentages,
multiple-extruder arrays, non-numeric values and out-of-range values are
rejected. The PR gate exercises parser unit tests and a mock native API session
to assert all four keys actually reach `applyProfile("orca.native-json", ...)`.

This is **not** evidence of v2.5.0 desktop-versus-WASM G-code speed parity, nor
a real-browser verification of the four speeds' effect on tool motion. All
other unsupported full-profile keys remain excluded; existing candidate WASM
and public Pages remain unchanged. Do not print test G-code.

## 2026-11-15: isolated Chrome gate for a newly forwarded v2.5.0 process speed

The browser WASM diagnostic now compares two slices of the same 20 mm cube
fixture with identical layer, wall, and travel settings, varying only
`top_surface_speed` to an intentionally low 2 mm/s. The regression reads the
**actual G-code asset**, extracts modal F on positive-extrusion moves, and
requires newly observed low F values not present in the baseline. It does not
accept a G-code hash change alone, because metadata/header differences could
hide an ignored process option. Other three newly bridged speed options remain
API-forwarded but **are not individually verified in native G-code yet**.

This experiment does not assert realized printer speed, velocity planning,
desktop OrcaSlicer parity, full profiles, or G-code print safety. It runs only
with the verified local WASM artifact under isolated Chrome CI and is not
activated on public Pages. PR CI must pass before this gate is accepted.

## 2026-11-15: isolated sparse-infill commanded-speed regression gate

The local-only Chrome/WASM probe now slices the same synthetic two-cube STL
plate twice using identical diagnostic settings and a fixed, nonzero
`sparse_infill_density:35`. The sole changed property is
`sparse_infill_speed:2` mm/s. The test rejects header-only/hash-only
changes by comparing actual positive-extrusion G-code feedrate values and
requiring a newly observed slow feedrate at or below 150 mm/min.
This test does **not** prove the exact native desktop feature classification,
full-profile parity, actual machine motion, or safe printability. No upstream
source, production Pages settings, or pinned engine artifact changes.

## 2026-11-16: isolated internal solid infill speed regression gate

The local-only Chrome/WASM regression now slices the same two-cube STL plate
with the same bounded diagnostic process configuration previously used for
sparse infill, varying only `internal_solid_infill_speed` to 2 mm/s.
It compares the **actual deposited G-code feedrates** (not configuration
comments or hashes) against the unchanged baseline, requiring at least
one new low F command at or below 150 mm/min. This is a fail-closed CI
acceptance gate: its presence in code alone is not a passing result.

This is not a native v2.5.0 desktop comparison, an assurance of exact
feature-type attribution, proof of printer motion or print-ready G-code.
The candidate WASM binary and public Pages deployment are unchanged.
Gap-infill speed remains unverified in real WASM G-code.


## 2026-11-16: gap infill speed path-existence diagnostic (not yet verified)

A real isolated-Chrome v2.5.0 WASM test changes only the restricted
`gap_infill_speed` to 2 mm/s against the same diagnostic process settings.
The original two-cube plate yielded identical deposited-feedrate sets
despite this override ([initial failing probe #43732395872](https://github.com/temesotejam/layer-workbench/actions/runs/43732395872)).
A second triangular-prism/wedge OBJ fixture also yielded identical
sets and **no gap-fill comment evidence** ([second diagnostic #43732653122](https://github.com/temesotejam/layer-workbench/actions/runs/43732653122)).
These failures are *inconclusive*: without any identified gap-fill path,
the tests cannot distinguish a correctly ignored speed for a nonexistent
feature from a broken profile-to-engine path.

The Chrome diagnostic now records a structured
`parity-output/gap-wedge-feedrate-diagnostic.json` with actual deposited F
sets, gap comment samples and an explicit `inconclusive_no_gap_paths_observed`
status. It **never marks gap-infill speed verified** unless a newly observed
low deposited F appears; if a path is labelled gap fill but F does not respond,
it fails instead of silently passing. This does not assert native-desktop
parity, machine readiness or a verified fourth speed. Next: construct a pinned
fixture with actual gap-fill toolpaths confirmed by native feature tags,
then rerun the speed-only A/B test and compare against desktop v2.5.0.


## 2026-11-16: narrow-ring gap-fill fixture and feature-attributed speed audit

The earlier wedge had no proven gap-infill extrusion. The isolated Chrome
probe now uses a **closed 40 × 40 × 8 mm hollow OBJ ring with 1.5 mm walls**,
with independent unit checks for watertight manifold edges, signed volume,
and bounded geometry. This better targets the narrow spaces between classic
perimeters described by upstream, but it does **not** force the native
wall-generator mode or prove a gap-fill feature will occur.

The bounded G-code preview parser now preserves explicit comment-only
`;TYPE:` / `;FEATURE:` tags on generated positive-extrusion segments.
The gap-speed gate compares **tagged gap-fill deposition feedrates** between
identical-geometry slices with only `gap_infill_speed` changed to 2 mm/s.
A new generic low F alone **cannot** cause a false gap-feature PASS.
If no labelled gap deposition exists, the status stays inconclusive;
if labelled paths exist but no targeted speed response occurs, the Chrome
test fails and archives `parity-output/gap-ring-feature-diagnostic.json`.
The same feature tags can inform a later feature-colored Preview, but
they are not authoritative without independent native classification.

The test intentionally does not claim a fourth validated process speed,
native desktop/WASM parity, complete PrintConfig, or print-ready G-code.
It runs with the pinned, previously accepted engine in localhost COOP/COEP.
No WASM binary, vendor data, or unverified printer feature is published.


## 2026-11-16: feature-selectable 2D and 3D localhost G-code preview

The isolated Prepare lab can now select deposition by an explicitly labelled
G-code feature (comment-only `;TYPE:` or `;FEATURE:`). Both the 2D per-layer
view and the 3D toolpath view use the same selection and hide travel paths
when a deposition type is selected. Unclassified extrusion has its own
choice, distinct from a literal feature named "unclassified". Options show
counts of rendered deposition segments, not independent physical print
features or verified deposited volume. The 3D camera pose is preserved
during type selection.

This opt-in localhost-only diagnostic does not prove desktop feature
classification parity, toolpath correctness, real printer speeds, or
print-ready G-code. The public Pages site still has no certified WASM
engine deployment.

## 2026-11-16: malformed explicit feature tag must not inherit stale type

The read-only localhost G-code preview parser now clears the current deposition
feature when it encounters a syntactically recognizable but invalid explicit
`;TYPE:` or `;FEATURE:` directive (empty, overlong, or containing an extra
semicolon). Previously the old feature survived, potentially attributing
subsequent deposition to a prior `gap infill` section even when the intervening
directive was not understood. Ordinary non-directive comments still preserve
the previous feature, as required for line-level G-code comments.

A focused parser regression exercises valid → malformed → valid → malformed
transitions and asserts that the affected extrusion is unclassified. This
improves *diagnostic attribution integrity only*. It does not prove that the
WASM engine generates gap-fill paths, verify the fourth deposition speed, show
OrcaSlicer desktop G-code parity, or authorize printing/deployment. No public
site or WASM binary is modified.

## 2026-11-16: explicit native classic wall and gap-fill mode for isolated gap probe

The bounded localhost process adapter now accepts only the pinned native
`wall_generator` tokens `classic`/`arachne` and `gap_fill_target` tokens
`everywhere`/`topbottom`/`nowhere`. Profile inheritance keeps exact string
values, and the second process-override gate preserves these choices for
`session.applyProfile("orca.native-json", ...)`. Invalid casing, arrays,
numeric coercions and unknown values fail closed, with unit and mock-bridge
regressions. The isolated gap-ring experiment explicitly requests
`wall_generator:"classic"` and `gap_fill_target:"everywhere"` for both
its baseline and 2 mm/s candidate, based on Orca's documented distinction
between adaptive Arachne and classic-perimeter gap fill.

**Acceptance boundary:** a successful parser or CI run alone does not prove
that native WASM produced any tagged gap-fill paths or honored the selected
wall generator. The feature-attributed G-code diagnostic must show actual
gap deposition and a speed-only F difference before the fourth process
speed can be called verified. These settings are diagnostic-only; no public
Pages engine, printer compatibility, full-profile parity, or print-safe
G-code is claimed.

## 2026-11-16: actual tagged Gap infill F120 in pinned isolated Chrome (PR #31)

With the **same accepted native v2.5.0 WASM binary**, the explicit
`wall_generator: "classic"`, `gap_fill_target: "everywhere"` settings
allowed the existing 1.5 mm hollow-ring OBJ fixture to generate **756**
`gap fill`/`gap infill`-labelled deposited preview segments in *each* of two
isolated-Chrome slices. With only `gap_infill_speed` varied, the baseline
tagged gap deposition speeds included **583.27–999.94 mm/min** plus other
values; the 2 mm/s candidate introduced **F120 (120 mm/min)** on actual
tagged deposition segments. The two slices kept the same number of tagged
gap segments. See [real Chrome CI #43769398714](https://github.com/temesotejam/layer-workbench/actions/runs/43769398714),
which **PASSed** with `observed_tagged_gap_feedrate_effect`. The official
profile/inheritance and mock bridging checks also **PASSed** in
[PR CI #43769398709](https://github.com/temesotejam/layer-workbench/actions/runs/43769398709).

The Chrome acceptance gate is now strict: missing explicit tagged gap
deposition on either side, or failure to introduce the target F120
on tagged gap deposition, **FAILS** the run instead of reporting an
inconclusive green build. Actual physical acceleration, material flow,
native desktop-vs-WASM equivalence, arbitrary printers/profiles,
verified 3MF compatibility, and print safety remain unverified.
No production Pages engine or heavyweight WASM candidate was changed.


## 2026-11-16: source-pinned native bridge-speed option forwarded (candidate validation)

The opt-in isolated localhost profile bridge now recognizes **`bridge_speed`**
only as a bounded, absolute millimetres-per-second number (1–800), rejecting
percentages, unsupported vectors, and malformed values. The v2.5.0 pinned
Creality CR-10 0.20mm Standard child process preset has `bridge_speed: "50"`;
its native key is forwarded via the same validated `orca.native-json` process
path as the previously accepted infill speeds. The unit, upstream-inheritance,
mock-session-forwarding and isolated Chrome candidate checks are CI gates.

**Evidence limit:** a separate pair of cubes is used in the Chrome smoke test,
which need not generate any bridge path. A successful test only demonstrates
that the setting is accepted by this restricted bridge and slicing still
produces deposited G-code; it **does not** establish a bridge-feature feedrate
change, native G-code parity, full printer-profile support, or print safety.
A future geometric bridging fixture must require tagged bridge deposition
segments and measure their commanded `F` before claiming an actual bridge
speed effect. The feature remains local opt-in and is not enabled on Pages.

## 2026-11-16: actual bridge-feature F120 verified on unsupported arch (PR #41)

The isolated Chrome test now uses a dedicated watertight, one-piece concave
OBJ arch (40x20x15 mm, 16x20 mm open tunnel to Z10). The fixture's 28
outward-oriented triangles, manifold edges, signed volume, bounds and
genuinely open underside are independently unit tested. Both slices use
identical diagnostic settings except `bridge_speed:40` versus `bridge_speed:2`
(absolute mm/s), under the same accepted v2.5.0 pthread WASM artifact.

[Initial real Chrome run #43833053887](https://github.com/temesotejam/layer-workbench/actions/runs/43833053887)
PASSed with **279 explicitly bridge-tagged positive-extrusion segments in
each run**. On the base 40 mm/s setting the actual bridge-tagged feedrates
were F954.93 and F1385.88 mm/min; on the candidate 2 mm/s setting they
were F120 and F180 mm/min. A newly introduced **F120** was observed on
genuine bridge-tagged deposition, not merely in profile metadata or
unrelated travel. The two runs had 120 layers each, and 4268 vs 4276
all-feature extrusion segments. See the archived
`parity-output/bridge-arch-feature-diagnostic.json` for the full evidence.

**Acceptance is now strict:** the Chrome test fails if either run lacks
valid tagged bridge extrusion, or if the candidate does not introduce
F120 in the bridge-attributed paths. The parser never treats only a header
change, travel move or arbitrary unlabelled speed change as sufficient.
F180 remains visible in the candidate and is not concealed as universal
F120 behavior. These are **commanded** G-code feedrates in one fixture,
not measured nozzle velocity. There is no native desktop/WASM G-code
parity finding, full official profile support, print-safety claim, or public
WASM Pages deployment. The heavyweight engine was not rebuilt.

## 2026-11-16: strict bridge feature-label parity guard (diagnostic)

The isolated Chrome/WASM bridge feedrate audit now recognizes only the **six
explicitly named bridge G-code features** already accepted by the official
native v2.5.0 diagnostic: `bridge`, `external bridge`, `internal bridge`,
`bridge infill`, `internal bridge infill`, and `bridge over infill`.
Case and repeated whitespace are normalized, but labels such as
`non-bridge`, `not bridge`, or `bridge overhang` cannot contribute to
the apparent F120 bridge result. Both baseline and candidate reports also
include per-feature deposition-segment counts, so future native-versus-WASM
comparisons can distinguish different bridge subtypes instead of only
comparing total counts. Synthetic positive and negative regressions run
alongside the real isolated Chrome probe.

This is an **attribution integrity improvement**, not a desktop-versus-WASM
comparison. Identical nominal labels would still not establish identical
effective printer/process/filament settings, object placement, ordered
toolpaths, actual machine speeds, or safe printing. No new WASM artifact
is built and the public Pages slicer remains disabled.

## 2026-11-17: localhost process JSON allow-list hardening

The opt-in localhost process override parser now requires every incoming JSON key to be an **own** property of its numeric-key allow-list. In JavaScript a direct `LIMITS[key]` lookup can also resolve inherited names such as `constructor`, `toString` and `__proto__`, bypassing the intended numeric bounds. Regression tests submit these names through real `JSON.parse` objects and require rejection. The native enums continue to use own-property checks. This is a parser-validation correction only; it does not increase the number of supported OrcaSlicer settings, establish G-code parity or permit public/physical printing.

## 2026-11-17: per-subtype bridge XY path length (pre-parity diagnostic)

The isolated WASM Chrome bridge audit now additionally reports cumulative
positive-E XY path lengths (millimetres, rounded to 0.000001 mm) under the
same strict six bridge feature labels as the native diagnostic. Regression
checks ensure that replacing a 2 mm straight bridge with two 1 mm lines
changes the **count** but not the **total length**. Non-finite distances,
unknown labels, zero-XY priming and travel do not count. The native CLI audit
separately measures the corresponding straight positive-E **G1** subset.

Length comparisons can help identify path-geometry differences masked by
segmentation counts, but the current native full official profiles and
WASM restricted local profiles are **not equivalent**. Browser arcs may be
tessellated, native arcs are excluded, and these aggregates do not establish
ordered coordinate, extrusion-volume or F-value equality. No printer-safe
G-code or public engine activation is implied.

## 2026-11-17: speed-only bridge G-code geometry consistency gate (diagnostic)

The existing isolated Chrome bridge-speed experiment compares the same arch
fixture and test process settings, changing only `bridge_speed`. The browser
audit now requires **both** feature-attributed XY deposition length and the
XY bounding envelope (min/max X/Y) of every explicit bridge subtype to remain
within 0.01 mm between baseline and candidate. An F120 newly appearing only
on shifted, shortened or reclassified bridge paths is recorded as
`bridge_geometry_changed_speed_unverified`, **not** as successful
speed-only evidence. A different subdivision of the same straight path
is accepted. Negative regression tests exercise identical-length shifted
paths, lost length, subtype changes and the tolerance boundary.

The old actual Chrome fixture reported 279 bridge-tagged extrusion segments
in each run and identical length 2491.612469 mm; the new independent envelope
gate must also pass in real Chrome CI before promotion. This gate is designed
for **two runs of the same restricted WASM fixture**, not for comparing the
native CLI to WASM. Per-feature length and bounding envelopes are coarse
invariants: they do not prove the same ordered XY/G-code paths, extrusion
volume, arc interpretation, full profile equivalence or print safety.
The candidate WASM artifact and production Pages remain unchanged.

## 2026-11-17: 3D commanded-feedrate color preview (localhost opt-in only)

The isolated 3D G-code viewer now provides a switch between the previous
T-selector colors and six fixed diagnostic bins of **modal G-code F** (including
a distinct unknown-F bucket). Values are parsed as mm/min and displayed as
mm/s. Toolpath geometries and feature filtering are unchanged by switching
colors. Standalone unit tests cover boundaries and invalid/missing F.
The isolated Chrome flow checks that real WASM G-code retains the same
segment count before, during, and after palette changes, including with
a feature filter active.

This is a **display-only improvement**, not a native OrcaSlicer Preview
replica, actual speed measurement, acceleration simulation, full-profile
parity, executable/print-safe G-code, or a production deployment. The
published Pages app still does not enable the WASM engine.

## 2026-11-17: isolated 3D preview single-layer inspection

The localhost-only G-code-derived 3D Preview can now switch between showing
all layers through the selected Z index and **only the selected Z layer**.
The Z slider is preserved when changing the commanded-F palette or the
explicit-feature filter on the same parsed G-code; loading new G-code resets
to the final layer. The viewer tracks actual shown segment/layer counts
separately from the immutable total parsed toolpath count. Both display modes
reuse the already parsed G-code and do not alter generated G-code or slicing.
The isolated Chrome regression checks the modes, layer counts, selection
preservation and the return to cumulative display on a real WASM slice.
This is still a diagnostic subset of OrcaSlicer's native Preview, not proof
of visual parity, native project semantics, actual motion speed or print safety.

## 2026-11-17: synchronized 2D and 3D G-code layer selectors

The isolated localhost 2D and 3D G-code viewers now share the selected **Z-level index**.
Dragging the 2D layer slider updates the 3D selected layer without regenerating
geometry; dragging the 3D slider updates the 2D plot and layer label. Changing
3D single/through-layer mode, palette or explicit feature filter preserves the
selection on the same parsed G-code. Loading a new slice resets both selectors
to the last Z level. An out-of-range programmatic 3D selection is rejected,
and clearing preview state does not attempt to render an obsolete layer.

The real isolated Chrome/WASM regression moves both sliders at the first, last
and an intermediate layer and checks cross-view selection and labels. This is
read-only visual coordination, **not** native OrcaSlicer Preview parity, full
3MF/profile compatibility, G-code modification or a production deployment.

## 2026-11-17: selected restricted process settings applied by the WASM bridge

The direct `sliceMultiStlWithEngine` helper previously required callers to
repeat `profileCollection.process.settings` in the separate
`processOverrides` argument. The interactive local Prepare lab happened
to pass this duplicate argument, but other callers could supply a selected
Orca machine/filament/process collection and **silently slice with generic
PLA process defaults**. This ambiguity obstructed controlled profile
comparison, even for the small supported process subset.

The bridge now resolves its **effective, bounded test-only process fragment**
before opening a WASM session: it takes the explicitly selected inherited
process settings by default; separately supplied manual overrides replace
only overlapping keys; each source independently passes the existing strict
native-key/enum/number allow-list. The effective fragment is applied once,
before setting plate objects. Missing, empty, unsupported or out-of-bounds
selected process settings cause an error rather than silent generic fallback.
The generic PLA fixture still works when no collection was selected.

`scripts/test-slice-stl-process-application.mjs` uses a mocked session to
check calls, merged option precedence, no duplicate profile application,
and rejection before session creation. The source-pinned real-profile and
isolated Chrome workflows run the regression. **No full native PrintConfig
is forwarded**: all unsupported machine/process/filament keys, variant
semantics, start/end G-code, native-vs-WASM parity, print safety and public
WASM deployment remain unverified. The change does not enable any feature
on GitHub Pages.

## 2026-11-17: fail-closed restricted machine/filament session.init validation

The opt-in localhost WASM bridge now validates the **actual machine and
filament configuration passed to session.init** before opening a session.
Previously, direct callers could supply a nominally selected collection with
arbitrary additional settings (including executable printer-start G-code)
because only process overrides had a strict allow-list. That made a
supposedly restricted comparison capable of silently accepting unaudited
machine/material keys.

Only the already supported bounded, single-nozzle machine dimensions and
single-filament temperatures/flow vectors are accepted. A selected plate
must use one exact upstream v2.5.0 bed enum and matching native temperature
vector; a bounded legacy scalar bed_temperature remains available without
inferring a plate type. No implicit native plate choice or multi-tool vector
coercion is allowed.
Missing required settings, inconsistent selected-plate temperatures,
unsupported keys, malformed vectors and injected machine/filament G-code
are rejected **before createSession**. Generic PLA test fixtures without a
selected profile still use their existing explicit development defaults.

The test-slice-stl-process-application.mjs regression checks valid
single-tool/plate fields and rejection of untrusted direct-input objects.
This is a defensive gate for **the restricted adapter**, not evidence that
the full official machine/filament configuration is now implemented, nor
proof of native-versus-WASM G-code parity, machine compatibility, printer
readiness, or a public WASM deployment. Official vendor JSON remains an
ephemeral CI input; the accepted engine candidate is unchanged.

## 2026-11-17: fail-closed official filament material type in the localhost adapter

The pinned OrcaSlicer v2.5.0 Creality `fdm_filament_pla` source has
`filament_type: ["PLA"]`; the existing tested browser `session.init`
fixture uses scalar `filament_type: "PLA"`. The restricted profile resolver now
explicitly inherits and validates exactly this **single-slot PLA** vector and
forwards the proven scalar representation. Non-PLA, multi-slot, malformed or
ambiguous material declarations are rejected, including when passed by a
direct caller to `makeRestrictedInitConfig`. This prevents a user-selected
PETG/ABS etc. preset from being silently sliced as generic test PLA.

The synthetic resolver tests verify inherited and child-override PLA, bad
material vectors and unsupported materials; restricted session-init tests
verify that invalid direct inputs fail before WASM session creation. Missing
material declarations retain the explicitly labelled generic-PLA developer
fallback, not a printer-profile claim. This supports **one additional exact
material key only**, not native filament/multi-extruder parity, real-material
validation, physical printing or production WASM deployment. Upstream input
was inspected at source pin `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`.


## 2026-11-17: source-pinned one-slot filament diameter in restricted localhost bridge

The pinned OrcaSlicer v2.5.0 `fdm_filament_common` profile defines
`filament_diameter: ["1.75"]`, inherited by `Generic PLA @System`.
The restricted one-filament adapter now retains this option as a native
single-element vector, bounded to **1–3 mm** for the isolated diagnostic.
The inherited child value overrides the parent; multi-value, missing-slot,
non-numeric and out-of-range explicit values fail closed. Direct callers to
`makeRestrictedInitConfig` also cannot bypass the bounds before creating
a WASM session. No automatic fallback from a malformed selected diameter
to the developer's generic filament setting is permitted.

The pinned-real-profile CI asserts the literal inherited 1.75 mm value.
The isolated Chrome probe compares **actual XY G1 E numeric values** after
slicing the same models with only test `filament_diameter` changed from
1.75 to 2.85 mm; metadata/hash changes alone do not satisfy that gate.
This proves at most a bounded, single-profile extrusion-command response
inside the accepted localhost test engine. It is **not** full material
compatibility, official native-vs-WASM G-code parity, an actual extruder
calibration, physical print safety or permission to enable the public
Pages engine. Other native machine/process/filament options remain missing.

## 2026-11-17: source-pinned sparse infill pattern routing (localhost only)

The official v2.5.0 source pin `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`
defines `sparse_infill_pattern: "crosshatch"` in
`Creality/process/fdm_process_common.json`, while
`0.20mm Standard @Creality CR-10 0.4 nozzle` overrides it to `"grid"`.
The restricted profile resolver and `session.applyProfile` test adapter now
accept **only** those two source-pinned exact native enum tokens. Unsupported
patterns, UI labels, numeric stand-ins and vectors are rejected. A unit test
checks inheritance and child-override behavior, and pinned-profile CI checks
both actual upstream values without committing upstream vendor data.

The isolated Chrome test now slices the same two-cube STL project with a
nonzero infill density under otherwise identical process settings, changing
**only** grid versus crosshatch. It compares parsed deposited XY motion
geometry (not merely G-code SHA, metadata or config comments). This is a
bounded functional check in the accepted localhost WASM candidate. It is not
a full list of native patterns, desktop/native G-code equivalence, official
printer readiness, or permission to activate the public Pages slicer.

## 2026-11-17: bounded source-pinned absolute process line width (localhost only)

The official OrcaSlicer v2.5.0 source at
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` contains
`line_width: "0.42"` in the Creality CR-10 0.20mm Standard process preset.
The restricted profile resolver and `orca.native-json` bridge now forward
only finite, absolute 0.1–2.0 mm `line_width` values. Percentages,
multi-tool arrays and malformed values fail closed rather than silently
being reinterpreted as millimetres. Real-profile CI asserts the pinned
0.42 mm value. The isolated Chrome regression slices the same two-STL
project at 0.35 and 0.65 mm and requires a difference in actual G0/G1
motion/extrusion commands, not only headers or profile serialization.

This adds **one bounded process setting**, not the full Orca PrintConfig:
per-feature line widths, native full-preset equivalence, desktop-vs-WASM
G-code parity, actual print quality/safety, and public Pages WASM activation
remain unverified. The test model stays confined to isolated localhost CI.

## 2026-11-17: source-pinned independent outer-wall line width (localhost only)

The exact official OrcaSlicer v2.5.0 source pin
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` defines
`outer_wall_line_width: "0.4"` in the Creality common process and
`outer_wall_line_width: "0.42"` in
`0.20mm Standard @Creality CR-10 0.4 nozzle`. The restricted process
reader now independently inherits, validates and forwards the native
`outer_wall_line_width` key, with **absolute 0.1–2.0 mm only**.
The existing general `line_width` remains separate. Percentage values,
multi-nozzle arrays and malformed values are rejected rather than converted.

A source-pinned real-profile CI gate asserts the exact inherited value.
The localhost-only isolated-Chrome regression holds the general line width
at 0.42 mm, changes **only** the outer-wall width from 0.32 to 0.72 mm,
and requires the actual WASM G-code G0/G1 motion commands to change,
not merely JSON, headers or hashes. The assertion must pass in CI before
this key is considered functionally verified.

This is **one more restricted process option**, not a full PrintConfig
mapping, same-full-profile desktop-vs-WASM toolpath parity, verified real
printer G-code, or permission to publish the WASM engine on GitHub Pages.

## 2026-11-17: source-pinned independent inner-wall line width (localhost only)

The pinned OrcaSlicer v2.5.0 commit
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` defines
`inner_wall_line_width: "0.45"` in both `fdm_process_common` and
`fdm_process_creality_common`, and the CR-10 0.20mm Standard child
also sets 0.45 mm. Pinned `PrintConfig.cpp` declares this native key
as `coFloatOrPercent`. The isolated test adapter accepts **absolute
0.1–2.0 mm only**, inherited independently of `line_width` and
`outer_wall_line_width`. Percentages, ambiguous values, multi-nozzle
vectors and missing-value inference are not accepted.

Source-pinned CI validates the official values; dedicated unit tests
check inheritance, child precedence, single-nozzle native vectors and
strict override rejection. The isolated Chrome test holds general and
outer-wall width at 0.42 mm, changes **only** inner-wall width between
0.32 and 0.72 mm, and requires a difference in actual G0/G1 motion
commands. A functional PASS is claimed only if that Chrome gate passes.

This bounded addition does not prove native desktop/WASM full-profile
G-code parity, correct multi-extruder assignment, physical print quality,
or safe printable output. No WASM engine is activated on public Pages.

## 2026-11-17: source-pinned sparse-infill extrusion width (localhost only)

Pinned upstream OrcaSlicer v2.5.0 commit
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` defines
`sparse_infill_line_width: "0.45"` in the common Creality process,
its Creality intermediate preset and the CR-10 0.20mm Standard process.
The restricted profile resolver preserves the independently inherited key;
the localhost WASM test adapter accepts only **absolute 0.1–2.0 mm**.
Percentage expressions, ambiguous values and multi-nozzle vectors fail
closed. Missing values are not guessed from `line_width` or wall widths.

Pinned-profile CI verifies the exact upstream value. An isolated Chrome
regression holds general/inner/outer wall widths and sparse infill density
fixed while changing only sparse-infill width from 0.32 to 0.72 mm; it
requires actual G0/G1 motion differences, not just JSON or G-code headers.
The functional claim remains contingent on that browser test passing.
Neither the test fixture nor this one-key bridge establishes same-full-profile
native-vs-WASM G-code parity, multi-tool behavior, print safety or permission
to enable the public Pages WASM slicer.

## 2026-11-17: source-pinned top-surface line width in isolated WASM

The official OrcaSlicer v2.5.0 commit
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` defines
`top_surface_line_width: "0.4"` in both common process ancestors;
the CR-10 0.20mm Standard child overrides it to `0.42` mm.
The restricted localhost resolver now inherits this native key separately
from general, wall and sparse-infill widths. Only bounded absolute
0.1–2.0 mm values are permitted; relative percentages, ambiguous
multi-extruder arrays and fabricated missing defaults are rejected.

Source-pinned profile CI checks the real ancestor/child values. Isolated Chrome
CI slices the same two-STL fixture with 0.32 and 0.72 mm top-surface width
and all other widths and top-shell count fixed; only changes in genuine G0/G1
toolpaths count as acceptance, not metadata changes. This limited development
proof is not desktop G-code parity, full 3MF support, print safety, or a public
Pages WASM deployment. The official JSON stays in CI only.


## 2026-11-17: pinned internal solid infill width in localhost WASM diagnostics

The restricted localhost process profile resolver and override parser now
accept `internal_solid_infill_line_width` independently of general, wall,
sparse infill and top-surface widths. The pinned official OrcaSlicer v2.5.0
Creality CR-10 0.20mm Standard chain sets it to 0.45mm in the common base,
0.4mm in the Creality common ancestor and 0.45mm in the CR-10 child. The bridge
permits only bounded 0.1–2.0mm absolute single-nozzle values; percentage,
multi-tool, invalid and missing values are never guessed. Unit tests cover
inheritance, overrides and invalid inputs. The isolated Chrome/WASM regression
holds other widths, infill density and shell counts constant and requires
changed actual G0/G1 motion when this one width changes from 0.32mm to 0.72mm.
Only a passing corresponding Chrome CI run establishes this last behavior.

This does not establish native-vs-WASM G-code parity or a print-ready machine
profile. No WASM engine, licensing resources or public Pages integration changes.

## 2026-11-18: source-pinned initial-layer width in isolated WASM

Pinned OrcaSlicer v2.5.0 commit `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`
defines native `initial_layer_line_width` in the Creality CR-10 chain:
`0.42` mm in `fdm_process_common`, overridden to `0.5` mm in
`fdm_process_creality_common` and retained as `0.5` mm in the
0.20mm Standard child. The localhost-only process resolver forwards the
independent first-layer extrusion width, preserving native inheritance,
accepting only absolute 0.1–2.0mm single-tool widths and rejecting percentages,
multi-tool vectors, missing defaults and malformed overrides.

The pinned-profile CI asserts the actual source values. The isolated Chrome
regression slices unchanged STL inputs twice with the other widths and
initial-layer height held fixed, comparing genuine G0/G1 movement commands
at 0.32mm versus 0.72mm first-layer width. The experiment counts as functional
evidence only once that real WASM gate passes. It is not same-full-profile
native/WASM G-code parity, machine certification, full 3MF support, print
safety, or permission to expose the candidate engine on public GitHub Pages.

## 2026-11-18: source-pinned first-layer speed in isolated WASM

Source-pinned OrcaSlicer v2.5.0 commit
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` defines the absolute
`initial_layer_speed` as 20mm/s in `fdm_process_common`, overridden to
15mm/s in `fdm_process_creality_common` and inherited by
`0.20mm Standard @Creality CR-10 0.4 nozzle`. The restricted localhost
process resolver and explicit override allow-list now carry this native key
independently of first-layer *infill* speed, wall speeds, travel speed and
first-layer line width. Only 1–800mm/s absolute single-tool scalar settings
are admitted; relative percentages, multi-tool lists, malformed and missing
values are not inferred.

The pinned upstream CI checks the actual parent/child settings and rejection
cases. The isolated Chrome regression varies only this one process setting
(5 vs 15mm/s), requires real deposited first-layer G-code with valid modal F
and compares first-layer extrusion feedrates. This counts as a runtime feature
only after corresponding Chrome CI passes; successful metadata-only parsing
is insufficient. Full original profiles, actual-machine safety, native vs
WASM G-code parity, 3MF project parity and public WASM deployment remain
unverified. This change does not ship WASM to Pages.

## 2026-11-18: source-pinned independent first-layer infill speed (localhost-only)

Pinned official OrcaSlicer v2.5.0 source commit
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` contains no
`initial_layer_infill_speed` in `Creality/process/fdm_process_common.json`,
but explicitly sets it to **20 mm/s** in both
`fdm_process_creality_common.json` and
`0.20mm Standard @Creality CR-10 0.4 nozzle.json`.
This is independent of `initial_layer_speed: 15` for the first-layer
perimeters. The restricted profile reader and native process override
adapter now preserve this key without aliasing, inferencing or accepting
percentages, multi-extruder vectors and out-of-range values; only bounded
absolute 1–800 mm/s scalars are accepted in the localhost test.

CI pinned-source tests check both actual upstream files and inheritance.
Isolated Chrome regression slices the same two-STL plate with perimeter
speed fixed at 15 mm/s, changing **only** first-layer infill speed between
5 and 20 mm/s, then compares positive-extrusion first-layer modal F values
from actual WASM G-code. A change is considered verified only if that
corresponding Chrome CI run succeeds. Neither metadata agreement nor a
build PASS establishes full effective-profile parity, real-printer safety,
3MF equivalence, or permission to publish WASM on GitHub Pages.

## 2026-11-18: source-pinned support dimensions and feedrates (ingestion only)

The strict localhost-only v2.5.0 profile bridge now preserves three
**independent** native CR-10 0.20mm Standard keys through actual upstream
inheritance (common → Creality common → CR-10 child):
`support_line_width` (**0.42 → 0.40 → 0.42 mm**),
`support_speed` (**40 → 150 → 30 mm/s**) and
`support_interface_speed` (**80 → 80 → 30 mm/s**). The bounded adapter
accepts only absolute 0.1–2.0 mm widths and 1–800 mm/s speeds, with
single-tool native array normalization only in the resolver. Relative
percentages, multi-tool ambiguity, malformed inputs and missing defaults
fail closed. Official source JSON is fetched only within CI.

**Support remains disabled** in the pinned CR-10 profile and
`enable_support` is intentionally excluded from the test override
allow-list. Real isolated Chrome/WASM checks only native-json ingestion and
subsequent successful slicing, **not actual support generation or support
toolpath effects**. The pinned child profile also has
`initial_layer_travel_speed: "50%"`; this relative speed remains
unsupported, not misrepresented as 50 mm/s. Native G-code equivalence,
print safety, full 3MF/project parity and production deployment remain
unverified; no WASM binary is deployed to public Pages.

## 2026-11-18: source-pinned support role diagnostic and negative control

Added `scripts/support-feature-diagnostic.mjs` and
`scripts/test-support-feature-diagnostic.mjs`. The read-only audit recognizes
only the four exact labels from official OrcaSlicer v2.5.0
`src/libslic3r/GCode.cpp` (pinned at
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`):
`support material`, `support material interface`, `support transition`,
and `support ironing`. It separately counts genuine positive-E XY
deposition by role, modal feedrates, gross length, and XYZ bounds. Header
mentions, travel-only feedrates, bare labels, vertical/pure-E priming, unknown
tags, or malformed tags cannot count as support extrusion. A future
same-engine speed test requires role-specific new F *and* stable gross geometry;
this is not a native/desktop G-code parity criterion.

The isolated Chrome test now saves
`parity-output/support-disabled-feature-diagnostic.json` for the existing
source-pinned support-disabled two-cube baseline and asserts that no labeled
support body/interface deposition appears. This **does not enable supports**
and does not demonstrate the effect of support speed or width. The next
acceptance step remains a bounded, explicit localhost-only support-enabled
overhang fixture with verified role-tagged toolpaths, tested without changing
the public Pages environment. Never use diagnostic G-code on hardware.

## 2026-11-18: isolated overhang support-generation positive gate (pending CI)

The localhost-only `?engineLab=1` diagnostic accepts the exact OrcaSlicer
v2.5.0 native `enable_support` tokens `"0"` or `"1"` **only when an explicit
local process JSON is supplied**. Unknown, numeric, boolean, relative and
multi-tool representations fail closed. The process panel is restricted to
cross-origin isolated localhost, and the public Pages application continues
to ship without the WASM candidate or this opt-in engine lab.

The isolated Chrome probe reuses the existing watertight 40 × 20 × 15 mm
unsupported tunnel arch (16 mm horizontal opening), holding the mesh,
wall/gap/bridge settings, and three bounded support widths/speeds constant.
It slices once with `enable_support:"0"` and once with `"1"`, archives the
actual per-role positive-E XY deposition evidence to
`parity-output/bridge-arch-support-on-feature-diagnostic.json`, and requires
no labelled body/interface deposition in the disabled control but actual
body/interface deposition in the enabled case. A support flag, config
comment, bridge-only path or successful slicing is **not** acceptance.

**Status:** code and test are staged; functional support generation is NOT
claimed until the isolated-Chrome workflow passes on the exact branch SHA.
Even a green gate proves only a bounded test overhang and one archived
WASM artifact. Full native-vs-WASM profile/G-code equivalence, real printer
support behavior, usable 3MF/STEP projects, and print safety remain unverified.
No output should be sent to a printer.

### API 0.7.0 support-toggle routing correction (first Chrome failure)

The first isolated Chrome run ([#44162923061](https://github.com/temesotejam/layer-workbench/actions/runs/44162923061))
completed all prior smoke probes but produced **zero** support-labelled deposited
segments with both `enable_support:"0"` and `"1"`; the new positive acceptance
assertion failed, as intended. This cannot be reported as generated support.

The pinned OrcaWasm modifier smoke (`scripts/patch-orcawasm-support-smoke.py`)
provides more precise API evidence: the engine consumes numeric
`support_enable: 1` via `session.init`. Passing the official process name
`enable_support` only into `orca.native-json` did not activate support in that
Chrome test. The restricted localhost adapter now explicitly translates
validated `"0"`/`"1"` to numeric `support_enable` **at init only** and
excludes the process key from `applyProfile`; all other supported process
settings retain their previous behavior. Mock-session tests require these
exact call paths, including no support enablement in the generic fallback.

The positive overhang probe remains a FAIL until a new real Chrome run
observes tagged support extrusion. Do not treat unit or source-profile
PASS as evidence of support generation or native G-code parity.

### 2026-11-18: sphere positive-gate follow-up to bridge-arch FAIL

The tunnel arch produced **zero** tagged support deposition with both toggle
values on Chrome run [#44164323045](https://github.com/temesotejam/layer-workbench/actions/runs/44164323045).
This is a genuine FAIL for the attempted positive assertion, not proof that the
engine ignores support. A bridge can be self-supported by its bridge extrusion.

The next Chrome candidate uses the **source-pinned support-modifier smoke's**
explicit `support_enable`, `support_type: normal(auto)`, and threshold of
10 degrees, applied in `session.init` to both the disabled and enabled
cases. It retains the arch output as an inconclusive control and adds a
watertight lower-hemisphere sphere with a Z=0 point for a strict positive
support-deposition gate. Both sphere slices share the same mesh and bounded
process settings; only the numeric `support_enable` differs. The local-only
diagnostic must show source-tagged positive-E XY support body/interface paths
on the ON case and none on OFF, or CI must FAIL. No public WASM activation,
full native parity, or print safety is claimed.

### 2026-11-18: explicit native-json support state after sphere FAIL

The next real isolated-Chrome run [#44165269422](https://github.com/temesotejam/layer-workbench/actions/runs/44165269422) still found **no tagged support deposition** on either arch or lower hemisphere, even with explicit init `support_enable:1`, `support_type:normal(auto)`, and threshold 10. This is a **FAIL**, not support equivalence.

The pinned Hiosdra/OrcaWasm source `scripts/smoke-test.mjs` at `60a09e04f1990be39c8f6f35dffef1a2c9e224c4` also sets `support_enable:1` through `applyProfileOnce(..., 'orca.native-json')` in its selected Voron profile smoke. The restricted adapter now forwards the validated numeric support flag and fixed support strategy through **both** `session.init` and `orca.native-json` on the explicit local diagnostic, with identical fixed settings for on/off. The positive sphere audit remains a mandatory FAIL gate until actual tagged deposition is observed; there is no published engine or printer-safety claim.

### 2026-11-18: support-toggle G-code effect classification (pending CI)

The second real Chrome support enablement trial [#44165901370](https://github.com/temesotejam/layer-workbench/actions/runs/44165901370) still found **zero tagged support body/interface deposition** on the bridge and sphere with the same bounded native init plus native-json support settings. The positive gate correctly **FAILed**, so PR #73 must remain unmerged.

A further strictly local read-only diagnostic now records the disabled and enabled sphere G-code SHA-256, byte lengths, positive-E feature-label histogram, and the count of tagged feature comments (including those mentioning support). This distinguishes truly unchanged generated paths from possible feature-label misclassification; no raw G-code is published. Until the Chrome gate observes actual support deposition, there is no supported positive claim or publishable feature.

### 2026-11-18: v2.5.0 native option-name mismatch identified (needs Chrome re-test)

A source-pinned investigation explains why the previous support ON/OFF
G-code motion SHA-256 values were identical. OrcaSlicer
[PrintConfig.cpp at 40ecc66f78ed](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/PrintConfig.cpp)
registers the **native key `enable_support`**, and its PrintConfig.hpp
contains `ConfigOptionBool enable_support`. There is **no**
`support_enable` option in that pinned native registry. However, the
Hiosdra/OrcaWasm modifier smoke fixture uses `support_enable`; its bridge
`oneslicer_init` catches unknown keys and silently skips them, while
`oneslicer_apply_profile` explicitly skips keys absent from
`print_config_def`. A successful call can therefore leave supports disabled.

The local-only adapter now forwards the *validated string* `enable_support:
"0"|"1"` under its exact native name to **both** init and native-json.
Mock tests reject the erroneous alias and preserve disabled generic defaults.
The source inspection identifies an ignored setting; **it does not yet prove
that support material is generated**. The strict support-feature positive
gate remains in force. Only a new real Chrome/WASM G-code result can resolve
the PR #73 failure. Avoid reporting support parity or print readiness.

### 2026-11-18: source-pinned threshold semantics and second positive gate

Run [#44170252177](https://github.com/temesotejam/layer-workbench/actions/runs/44170252177)
verified that correcting the native `enable_support` key still did **not**
generate any support-labelled XY extrusion in the 20 mm sphere (both 6,641
motion commands, motion SHA-256 identical). It therefore failed the **strict**
support-deposition gate; no feature success was inferred.

Official v2.5.0 `PrintConfig.cpp` defines `support_threshold_angle` as
generating supports for overhangs whose slope is **below** the threshold.
The prior test's 10° setting selects only a narrow slope region on a sphere
and is not a valid general positive acceptance fixture. The next isolated
Chrome probe explicitly sets 70° for **both** OFF and ON on the *same* sphere
and arch, with all process settings held constant and the native
`enable_support` toggle as the only changing key. This is diagnostic geometry,
not a recommended support threshold for printing.

The positive support body/interface G-code assertion is retained as a hard
FAIL. Until a real isolated Chrome run proves that deposition, PR #73 stays
unmerged and the public Pages app keeps the WASM engine disabled.

### 2026-11-18: support geometry works; exact G-code tag alias found

The 70° native `enable_support` sphere experiment in
[Chrome #44170725864](https://github.com/temesotejam/layer-workbench/actions/runs/44170725864)
**generated distinct G-code motion**: 6,641 moves / 5,238 deposited preview
segments with support OFF versus **9,330 moves / 7,298** deposited segments
with support ON. It emitted **1,489** segments tagged exactly `support`
and **586** tagged `support interface`, with 48 explicit support feature
comments. This is convincing independent geometry evidence, **but the old
positive test still failed** because its diagnostic recognized only the
untransformed `support material` and `support material interface` strings
from `GCode::extrude_support`, rather than the actual normalized browser
G-code tags. Failures were not silently waived.

The diagnostic now recognizes both **exact** observed emission tags
(`support`, `support interface`) in addition to the pinned role-label
strings, with explicit positive/negative unit fixtures. It continues to
require genuine positive-E XY movements (no metadata-only, travel-only or
substring matches) and the OFF control must remain free of support deposition.
Only a subsequent **passing** isolated Chrome test can close the PR #73
acceptance gate; no desktop native parity or print approval follows from
this bounded sphere test. GitHub Pages remains untouched.

### 2026-11-18: role-specific support speed deposition gate (isolated Chrome PASS)

The previous localhost-only, COOP/COEP Chrome probe established actual
support body and interface XY deposition from a 20 mm sphere when native
`enable_support:"1"` and a fixed 70-degree diagnostic threshold are set.
That alone does **not** show that the `support_speed` and
`support_interface_speed` settings change emitted G-code independently.

This opt-in follow-up compares the same sphere, engine artifact, support
enablement, support width, threshold, and all other process overrides.
It makes separate experimental slices with **only** `support_speed:3`
or **only** `support_interface_speed:3`, against the common 30 mm/s
baseline. The test uses `auditSupportSpeedEffect` to require positive-E
XY deposition tagged with the *correct role*, a new F180 (3 mm/s)
in that role, and stable role-specific gross path length and XYZ bounds
within 0.01 mm. It stores read-only summary statistics rather than raw
printer-ready G-code in `parity-output/sphere-support-role-speed-diagnostic.json`.
The independently observed `Support` / `Support interface` G-code tags
also have dedicated role-isolation unit tests.

The actual pinned v2.5.0 isolated-Chrome run
[#44187421608](https://github.com/temesotejam/layer-workbench/actions/runs/44187421608)
**PASSED** both strict role-specific speed checks. The body role has 1,489
deposited XY segments and unchanged 5225.274109 mm length; changing only
`support_speed` from 30 to 3 mm/s added tagged F180. The interface
role has 586 deposited XY segments and unchanged 1063.548691 mm length;
changing only `support_interface_speed` from 30 to 3 mm/s likewise
added tagged F180. Per-role XYZ bounds are unchanged in both comparisons.
The independent unit test of exact browser-emitted role aliases also
passed. The original 30 mm/s baseline emits lower nominal feedrates
(1124.8, 1310.22, 1591.18 mm/min), so equality with F1800 is **not**
assumed; speed limits and cooling may affect real toolpaths.

This proves only a bounded G-code feedrate effect on each addressed role
when changed separately, not that unrelated features never change.
It does not establish desktop native parity, cross-printer profile parity,
safe printable G-code, or public Pages WASM availability. No candidate is
enabled on the public website.


### 2026-11-18: support-line-width actual filament-E gate (isolated Chrome)

The source-pinned v2.5.0 local bridge already accepts bounded absolute
support_line_width, but accepting a profile is not evidence of deposition.
The existing support-on 20 mm sphere probe now runs two additional slices with
**only** support_line_width differing (0.32 vs 0.72 mm). A new read-only
support diagnostic follows M82/M83, G90/G91, G92 E, and G20/G21
while classifying exact Support / Support interface feature tags. It
counts genuine positive-filament-E G1 XY deposition, rejects ambiguous motion,
and independently reports support-body and interface filament-feed lengths,
XY lengths, and deposited segment counts. Header-only, travel, pure priming,
spoofed feature comments, or changed F-values cannot pass the material gate.

The isolated Chrome gate requires a **measured difference in support-body
filament feed** between the two otherwise identical slices. Its JSON summary
is archived under sphere-support-width-filament-diagnostic.json; it does
not store executable G-code. Synthetic unit tests cover
absolute/relative extrusion, G92 resets, unit conversion, disallowed commands,
and exact feature attribution. This experiment does *not* claim a linear
width-to-volume relationship: E is commanded filament length, not material
volume, and support path topology itself can change with configured width.
If the actual WASM run does not confirm a material effect, leave the PR
unmerged and investigate rather than relax the assertion. Desktop native
parity, physical print safety, and public Pages WASM activation remain unverified.


The isolated Chrome run
[#44198131705](https://github.com/temesotejam/layer-workbench/actions/runs/44198131705)
**PASSED** the new material gate and all Node diagnostic unit tests.
For 0.32 mm support width, the support-body role contained 1,547 positive-E
XY segments, 5,380.227929 mm XY length, and 142.44848 mm commanded filament E.
For 0.72 mm support width, body contained 1,048 segments, 3,367.740516 mm
XY length, and 227.28496 mm filament E (difference +84.83648 mm).
The support interface also changed (587 -> 419 segments; 30.2157 ->
49.51905 mm filament E). Because XY path topology and lengths changed,
this is **not** a fixed-path extrusion ratio or proof that rendered line
width matches the nominal setting. It does confirm the width setting
affects real support-tagged deposited G1 XY commands, not only headers.
Public Pages still does not load the WASM candidate.

### 2026-11-18: vendor-local inherited filament compatibility selection

The inspection-only multi-vendor filament alias selector now resolves
`compatible_printers` from the nearest filament ancestor *within the same
vendor namespace*. An explicitly present empty child list replaces any
inherited list; missing ancestors, cycles, and malformed/duplicate entries
fail closed rather than silently selecting a printer-specific preset.
The global `@System` fallback and existing pinned Prusa/Snapmaker selection
tests remain unchanged. A Node regression test covers inherited compatibility,
explicit override, malformed metadata, and cycles.

This does not implement the desktop's full compatibility-expression machinery,
does not resolve printer firmware support, does not forward additional machine
settings to WASM, and does not certify G-code or public Pages slicing.

## 2026-11-18: G18/G19 K-center words in diagnostic G-code previews

The opt-in read-only preview accepts numeric `K` offset words on `G2/G3` commands. On an XZ (`G18`) or YZ (`G19`) arc it still **does not draw** the unsupported curved path, but now advances the explicitly commanded XYZ/E endpoint before interpreting the next supported `G0/G1` move. Previously its strict word scanner rejected `K` as malformed and left the modal endpoint stale, making subsequent deposited line segments appear to start at the wrong coordinates. In a G17 XY arc, a `K` word is not interpreted, so the curve is omitted rather than drawn with the ignored offset. `K` on G0/G1/G92 remains unsupported and rejected.

This is a conservative visualization correction, **not** G18/G19 arc tessellation, CNC/firmware emulation, validated G-code execution, or native OrcaSlicer preview parity. Regression tests cover skipped-arc counts, preserved Z/E and follow-up extrusion coordinates for both planes, G17 fail-closed behavior, and rejection of unexpected linear K words. The Chrome/WASM CI's existing Node parser step runs these tests; it does not enable experimental WASM on public Pages.


## 2026-11-18: bounded G18/G19 vertical-plane G-code preview

The localhost diagnostic preview now tessellates bounded circular/helical G2/G3
arcs in all three conventional planes: G17 (XY, I/J), G18 (ZX, K/I),
and G19 (YZ, J/K). Using each plane's right-handed coordinate basis
preserves clockwise/counterclockwise direction when viewed along its positive
normal. Arcs may use the two in-plane center offsets or a signed R radius;
the third axis is linearly interpolated for true 3D helical segments. The
existing 2D layer picker still groups an entire arc by its destination Z:
this does **not** make a vertical-plane arc into a single horizontal layer.

Explicit P multi-turn commands, unexpected cross-plane center words, invalid
radii, ambiguous center/radius combinations, and arcs over the segment budget
remain omitted (while validly parsed modal XYZ/E endpoints advance). This is
**read-only visualization**, not full RS274 firmware emulation, cutter offset
handling, native OrcaSlicer preview equivalence, or evidence of printable G-code.
CI regression tests cover G18/G19 3D midpoints, CW/CCW direction,
radius and absolute/relative centers, helical third-axis interpolation,
subsequent linear paths, full circles and fail-closed input.
The public Pages application remains unchanged, with WASM candidate disabled.


### 2026-11-18: 2D planar-layer guard after vertical-plane arc support

The local-only 2D G-code layer preview now draws a segment only if its
actual source and destination Z coincide (within 1e-7 mm), and that
height is within the 0.001 mm destination-Z display bucket. True sloped
G0/G1 movements, G17 helices, and tessellated G18/G19 vertical-plane
arc sections are **omitted from 2D**, with a per-layer omitted count.
They remain visible with their actual XYZ endpoints in the 3D view.
This avoids representing nonhorizontal deposition as a fictitious XY
layer trace, even when the parser groups a complete arc under its final Z.
Regression tests cover helix segments, vertical-plane arcs, pure Z travel,
ordinary horizontal deposition and invalid heights.

The 3D slider still groups whole arc paths by their commanded destination
Z; it does not geometrically clip arcs at a layer height. The diagnostic
has no physical-layer validation, printer G-code execution, full desktop
preview parity, or print safety certification. Public Pages WASM is still
not enabled.


## 2026-11-18: source-pinned CR-10 skirt loop count (isolated proof only)

The official OrcaSlicer v2.5.0 pin `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`
sets `skirt_loops: "1"` in `fdm_process_creality_common`, overridden by
`skirt_loops: "2"` in `0.20mm Standard @Creality CR-10 0.4 nozzle`.
The restricted process reader and localhost native-json override adapter now
carry this *independent* integer setting, bounded to 0–10 loops. Percentages,
fractional values, negatives and multi-extruder vectors are rejected. The
pinned-real-profile CI verifies the inherited and child values.

The isolated Chrome regression compares the same two-STL scene with only
`skirt_loops` changing 0 → 2 and requires **more actual G0/G1 motion
commands**, not merely different metadata. A PASS demonstrates a skirt loop
response for the test scene and engine candidate only; it does not establish
native desktop parity, arbitrary model support, real-printer G-code safety,
or public Pages deployment. No engine build inputs or production settings
are changed.


## 2026-11-18: source-pinned CR-10 skirt distance (localhost proof only)

The upstream pinned OrcaSlicer v2.5.0 PrintConfig.cpp defines
`skirt_distance` as a millimetre `coFloat`, minimum 0, maximum 60,
default 2. Both `fdm_process_creality_common` and
`0.20mm Standard @Creality CR-10 0.4 nozzle` contain `"2"`.
The restricted raw-process resolver and local-only native-json adapter
forward this option independently of `skirt_loops`, allowing only
finite scalar values from 0 to 60. Percentages and multi-nozzle values
fail closed. Source-pinned inheritance and invalid-input tests are required.

The isolated-Chrome test keeps two skirt loops in the same two-STL scene,
varies only `skirt_distance` from 1 to 8 mm and checks G0/G1 motion
differences (not comments or file hash). This diagnostic is not equivalent
to a native-vs-WASM print-geometry parity verdict and does not certify safe
printer output. Public Pages engine activation and heavy WASM rebuilds
remain excluded.

## 2026-11-18: actual deposited skirt-distance XY envelope (local-only gate)

The previous source-pinned regression established only that changing
`skirt_distance` from 1 to 8 mm altered G0/G1 motion in the 2-STL fixture.
The additional `scripts/audit-wasm-skirt-distance.mjs` audit now inspects
*actual positive-E planar XY toolpaths*, restricted to explicitly emitted
`;TYPE:Skirt` or `;FEATURE:Skirt` tags in the bounded read-only parser.
It records both XY bounding boxes, segment counts and span increases;
travel, prime lines, non-skirt extrusion, sloped paths and G-code comments
cannot by themselves satisfy the gate. Synthetic tests cover absent feature
tags, zero expansion, reversed expansion, skipped arcs/malformed motion,
and invalid coordinates. The isolated Chrome probe records the numbers in
`parity-output/skirt-distance-geometry.json` and requires the larger
distance to expand BOTH XY spans by at least 2 mm without shrinking the
previous envelope by more than 0.5 mm.

A PASS only witnesses that this local WASM fixture produced outward skirt
deposition in both XY dimensions. Feature tags are required; if the engine
does not emit exact tags the gate correctly FAILS rather than inventing
a feature classification. This does **not** establish the exact 7 mm native
offset, 3MF/toolpath parity, G-code safety for a printer, or public Pages
WASM activation. No heavy engine binary/build inputs are modified.


## 2026-11-18: official CR-10 skirt-height and deposited-layer verification

Official pinned OrcaSlicer v2.5.0 Creality chain contains `skirt_height`
`2 → 1 → 2` across process common, Creality common and the CR-10 0.20mm
Standard child. The restricted localhost profile importer now forwards
bounded positive integer `skirt_height` 1–20 layers independently of
`skirt_loops` and millimetre-valued `skirt_distance`, rejecting percentages,
fractional values, zero, unverified arrays, and invented defaults.

In isolated Chrome, the same two-STL scene holds `skirt_loops=2` and
`skirt_distance=2` mm constant and varies **only** `skirt_height` from
1 to 3. The integration gate groups actual **Skirt-tagged, positive-E, planar
XY deposition** by commanded Z, requiring one versus three Z levels and
the same first-layer XY envelope. Unparsed G-code arcs or invalid motion fail
the test. Results are saved as local CI diagnostic
`parity-output/skirt-height-deposition.json`; no raw executable G-code is
published on Pages.

This proves a narrow setting-to-toolpath response only if the isolated
Chrome CI passes. It is **not** full upstream UI/3MF/G-code parity, nor
verification of native desktop per-object skirts/draft-shields or print safety.

## 2026-11-19: source-pinned CR-10 skirt speed (isolated browser gate)

The official pinned OrcaSlicer v2.5.0 `PrintConfig.cpp` defines `skirt_speed`
as a `coFloat` in **mm/s**, minimum 0 (zero requests native default-layer
extrusion speed), and default 50 mm/s. The selected Creality CR-10
`0.20mm Standard @Creality CR-10 0.4 nozzle` explicitly sets **20 mm/s**.
The restricted localhost test adapter resolves this independent setting
from the inherited process chain and forwards only a finite absolute scalar
in the deliberately conservative local range 0..300 mm/s. Percentages,
negative/nonfinite values, unverified multiple values and inferred defaults
remain rejected. This is not an endorsed speed range for a real printer.

An opt-in isolated Chrome regression holds two synthetic STLs, two skirt
loops, 2 mm distance, one layer and every other process setting fixed, and
changes **only** `skirt_speed` from 20 to 3 mm/s. It requires real
`Skirt`-tagged, positive-E horizontal XY deposition with finite modal
G-code F feedrates, nearly unchanged skirt XY length/envelope and a new
slow deposited F value not found in the baseline. A header echo, raw
G-code hash, travel move or other feature's speed cannot pass.
It records read-only evidence at `parity-output/skirt-speed-deposition.json`
without uploading raw executable G-code to Pages.

The strict check may fail if engine behavior, speed caps or layer-time
slowdown prevent the expected role-specific F difference; investigate
the logs instead of weakening the gate. Even a PASS proves only the
pinned candidate's bounded role-specific response, **not** desktop-native
G-code equivalence, arbitrary printer preset support, 3MF/UI parity,
print safety or public-site WASM activation. No heavy engine rebuild
is required for this profile-only change.

## 2026-11-19: pinned v2.5.0 CR-10 infill direction (isolated Chrome gate)

The official v2.5.0 Creality CR-10 0.20mm process and both of its
ancestors explicitly set `infill_direction = "45"` degrees at
source commit `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`.
The restricted localhost-only bridge now permits an independent, finite
0–360-degree native process angle. Numeric percentages, nonfinite values,
unverified multi-extruder vectors, and inferred defaults are refused.

The opt-in isolated Chrome probe keeps the two synthetic STL objects, 35%
sparse infill and grid pattern fixed, and changes only `infill_direction`
from 0 to 30 degrees. It requires **feature-tagged, positive-E, planar
sparse-infill segments** from real WASM G-code with different binned XY
angles. Metadata echoes, file hashes and travel-only paths do not count.
It records only numerical counts at
`parity-output/infill-direction-deposition.json`. If there are no
credible infill segments, the test must FAIL rather than claim success.

This adds one process key to the restricted profile bridge only when
the pinned-profile and isolated-Chrome checks pass. It does **not**
prove same-full-profile desktop G-code equivalence, full 3MF/UI parity,
physical print safety or public GitHub Pages WASM activation. Neither the
WASM engine binary nor vendor source profiles are changed/published.


## 2026-11-19: bounded v2.5.0 external bridge flow witness (localhost only)

The pinned CR-10 0.20 mm Standard process explicitly sets `bridge_flow: "0.95"`, a
**dimensionless flow multiplier** distinct from its `bridge_speed: "50"` in
millimetres per second. The restricted local process parser and real-profile
resolver now accept only scalar numeric `bridge_flow` in the conservative
0.1–2 range, preserving inherited child precedence. Percent tokens,
multi-extruder vectors, non-finite or negative input remain rejected.
This does not enable machine profile execution or declare any print safety.

The read-only G-code preview parser now records `commandedPositiveEMm` for
**linear XY/Z strokes**. It uses modal E positions and G20/G21 length units,
and excludes E-only unretraction from rendered strokes. Tessellated G2/G3
arcs explicitly carry `null` rather than attributing the entire commanded
E to each chord. This is commanded filament-axis distance, **not extruded
volume or physical material flow**. Toolpath geometry, strict parity gating,
and the public site's WASM-disabled behavior are unchanged.

The isolated Chrome/WASM arch test slices the same unsupported-roof model
twice, varying only `bridge_flow` (the baseline native default versus 0.55).
Only bridge-tagged, positive-E linear toolpaths contribute to the read-only
E totals; a changed config header or output hash is insufficient. This
tests a limited external bridge effect, *not* the internal bridge multiplier,
full native preset equivalence, or safe machine G-code. The output is an
opt-in localhost diagnostic and the full-profile native/WASM parity gate
remains unmet.

## 2026-11-19: independent source-pinned internal bridge flow forwarding (localhost)

The official OrcaSlicer v2.5.0 source at pinned commit
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, in
`resources/profiles/Creality/process/0.20mm Standard @Creality CR-10 0.4 nozzle.json`,
sets **`bridge_flow: "0.95"`** and **`internal_bridge_flow: "1"`** in the same
process child. Previously, the restricted single-extruder process adapter
only forwarded `bridge_flow`. The second native key now has an independent
bounded scalar allow-list (0.1–2) in both inheritance resolution and the
local test process parser. Unit tests cover missing values, overrides, inherited
values, ratios versus percentages, malformed/vector inputs, and a mocked
`session.applyProfile("orca.native-json", ...)` call preserving both keys.

This verifies a **source-pinned profile-to-API forwarding boundary**, not an
observed change in actual internal-bridge toolpaths. A real isolated
Chrome/WASM fixture with verified internal bridge paths and a native same-profile
comparison remain necessary before claiming behavioral parity. The public
GitHub Pages engine remains disabled. These G-code outputs are not certified
for printing.

## 2026-11-19: independent internal-bridge commanded-E probe (diagnostic only)

The isolated Chrome smoke now slices the same real watertight arch twice with
`bridge_flow=0.95` explicitly fixed, changing **only**
`internal_bridge_flow=1.0 → 0.55`. Its read-only
`bridge-arch-internal-flow-diagnostic.json` records numerical G1 positive-E
filament-axis length, tagged XY path length and bounds for *internal bridge*
versus *other recognized bridge* features. The accepted labels are enumerated
rather than matching arbitrary strings containing "bridge"; unrelated,
invalid, arc-tessellated, or extrusion-only moves cannot prove internal flow.

An observed effect requires internal-bridge deposition on **both** sides,
decreased internal E, stable gross XY geometry, plus unchanged conventional
bridge deposition geometry and E. If the arch does not produce explicitly
tagged internal-bridge paths, the result is
`inconclusive_no_tagged_internal_bridge` and the **browser CI fails**.
The first [Chrome PR run #44448090200](https://github.com/temesotejam/layer-workbench/actions/runs/44448090200)
measured 180 internal and 107 other-bridge G1 XY positive-E moves per run.
Only `internal_bridge_flow` changed (1 → 0.55): internal positive E fell
79.52954 → 43.74125 mm, while other-bridge E stayed at 32.85963 mm and
both feature groups kept their measured XY length and bounds. The strict
observed-effect result is now an explicit assertion, not an optional
green diagnostic. These are **commanded E-axis lengths**, not confirmed
deposited polymer volume; the fixture G-code is not public, print-safe,
or evidence of native desktop G-code parity.

## 2026-11-19: pinned internal-solid infill monotonic enum (localhost only)

The source-pinned OrcaSlicer v2.5.0 Creality CR-10 0.20mm Standard process
explicitly sets `internal_solid_infill_pattern: "monotonic"`, independently
of `sparse_infill_pattern: "grid"`. The limited local profile resolver and
process override parser now allow **only** this observed internal-solid token;
other strings, arrays and non-string values fail closed. Pinned upstream
inheritance and process-override tests verify the distinct value, and an
isolated Chrome test checks that a real WASM slice accepts the forwarded
process option and emits motion paths.

An accepted profile and nonempty G-code do **not** show identical internal
solid infill trajectories or the same effective full profile as native
OrcaSlicer. No engine binaries, start G-code, real printer integration or
public Pages WASM enablement are changed. Full native/WASM parity and print
safety remain unverified.

## 2026-11-19: native internal solid monotonic/rectilinear experiment (localhost only)

In the [source-pinned OrcaSlicer v2.5.0 PrintConfig.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/PrintConfig.cpp),
`internal_solid_infill_pattern` is a native coEnum whose allowed values
reuse `def_top_fill_pattern`; the latter explicitly includes `monotonic`
and `rectilinear`. The pinned Creality CR-10 0.20mm Standard profile
still explicitly selects `monotonic`. Only these two audited wire tokens
are admitted by the *localhost-only* restricted raw-profile resolver and
override parser. Sparse, top-surface and other pattern settings remain
independent; arbitrary enum labels, vectors and unsupported values fail closed.

The isolated Chrome regression keeps the two-STL Prepare scene and all
process settings fixed and changes only the internal solid pattern from
monotonic to rectilinear. It requires more than ten **actual** linear,
planar, explicitly `internal solid infill`-tagged, positive-filament-E
XY strokes in each G-code output, then requires a change in their
ordered deposition stroke sequence. Header text, metadata, non-solid
features, G-code hash changes and unclassified paths cannot satisfy the
gate. A numeric-only summary is written to
`parity-output/internal-solid-pattern-deposition.json`; executable G-code
is not included in this summary. The CI must PASS before integration.

A changed *ordered* stroke sequence alone does not prove that the
unordered XY geometry differs, that native desktop uses the same effective
full profiles, that the 2,616 mm previously observed native/WASM solid
gap is reduced, or that G-code is physically safe. No candidate is made
available on public Pages by this experiment.


## 2026-11-22: isolated Prepare native 3MF read-only inspection

In the explicit localhost `?engineLab=1` mode, after loading a manually selected verified
WASM artifact, the selected 3MF can now be **inspected through native
`session.initProfile("project.3mf", bytes)` and `getManifest()`**. This is the
first narrowly scoped direct linkage from a selected 3MF in the Prepare viewport
to the native WASM import API. The local browser viewer still uses ThreeMFLoader;
the two representations are NOT synchronized and no editing or exporting is
enabled by this feature.

The read-only diagnostic checks the input ZIP signature and an 8 MiB cap, disposes
the native session on success/error, and displays only bounded counts of
plates/meshes/objects/instances. It compares the number of currently visible
Three.js build items from the *same original File* with the native instance count.
A count disagreement is flagged explicitly rather than silently treated as
equivalent. Even agreeing counts are not evidence of transform/mesh/settings
parity. Import failure is reported without leaking project metadata or filenames.
The original 3MF is never replaced or uploaded. The ordinary GitHub Pages UI
does not enable this diagnostic and no WASM binaries are published.

Lightweight CI executes `node scripts/test-inspect-native-3mf.mjs` with a fake
session, testing input refusal, manifest limits, privacy and disposal. These
tests do **not** establish successful import of a desktop-created 3MF in the
real WASM candidate. Follow-up: actual isolated-Chrome fixture inspection and
compare stable instance IDs, transforms and bounding boxes against desktop
OrcaSlicer before enabling any native transform/edit/export path.

## 2026-11-22: real Prepare 3MF inspector browser acceptance gate

The isolated Chrome regression in `scripts/test-engine-probe.mjs` now exercises
`#lab-inspect-3mf` through the **actual Prepare UI**, using the pinned local
WASM candidate and the independently generated two-build-item Core fixture.
It requires the original selected 3MF to expose two native instances, checks
the visible build-item count, verifies that the WebGL viewport remains unchanged,
and confirms that inspection does **not** enable 3MF slicing. The test also
checks that inspection is disabled before explicit local engine loading.
Changes to the inspector source or its unit test now trigger this Chrome CI gate.

This is a test of an **independent synthetic 3MF**, not a desktop-authored
OrcaSlicer project, real machine profile, transform synchronization, native
3MF editing/export or printing. The public Pages site still does not load WASM.
A green test is evidence for this read-only path alone.

## 2026-11-22: Native 3MF manifest relation classification

The opt-in Prepare inspector now classifies exposed native API 0.7.0 plate/mesh/object/instance IDs, object-to-mesh and instance-to-object/plate references, and the 16-element affine matrix shape. Results contain **only** bounded status labels (`unique`/`duplicate`/`unavailable`, `valid`/`broken`/`unverified`/`unavailable`, `valid`/`invalid`/`unavailable`). If a native imported 3MF does not expose a field, the status is `unavailable`, not a fabricated PASS. No source IDs, coordinates, paths, or private metadata are displayed. Regression tests include missing links, duplicate IDs, NaN and non-affine matrices. The isolated Chrome test checks that the real candidate returns only classified statuses.

This is **not a comparison to browser build-item transforms**, does not prove exact ID mapping to the Three.js viewport, and does not enable 3MF editing/export or printing. Next: establish and test a per-instance source-to-viewport mapping using verified native transform semantics and an independent Core 3MF fixture.


## 2026-11-22: read-only native/browser build transform-anchor spacing gate

The opt-in isolated Prepare 3MF inspector now computes **pairwise spacing**
between the native manifest's instance affine translation anchors and the
browser Three.js build-item world translation anchors. Pairwise distances
are order-independent and insensitive to the viewer's global -128 mm XY bed
origin translation. The result is only `consistent`, `mismatch`, or
`unavailable` with the number of compared pairs; IDs, coordinates, files
and raw transform values are never displayed or logged. The comparison
requires 2–64 instances, valid finite row-major native 4x4 affine matrices,
valid browser anchors, equal counts and a 0.05 mm distance tolerance.
Malformed or missing data produces `unavailable`, not a false PASS.

**This is a diagnostic, not instance identity matching or full transform
parity.** Equal pairwise distances can also arise from rotation, reflection,
permutation or different absolute placement; shared/nested Core components
can make top-level anchor spacing differ even with identical mesh geometry.
It does not compare vertex world bounds, pivot semantics, material settings,
3MF metadata or any printer-ready G-code. The public site remains unchanged;
only localhost + COOP/COEP + `?engineLab=1` exposes this test.

## 2026-11-22: isolated native/Three.js 3MF linear transform comparison

The read-only Prepare inspector now checks whether the native WASM manifest's
per-instance 3×3 affine linear transform blocks (rotation, nonuniform scale,
shear and reflection) form the **same unordered multiset** as the Three.js
build-item world matrices. Three.js column-major storage is converted without
changing the geometric transformation. The test ignores global XYZ translation
and does not depend on native object IDs or import enumeration order. Matching
uses tolerance 1e-5 per dimensionless element and a bounded bipartite matching
algorithm (1–64 instances). Singular, malformed, nonfinite or missing matrices
produce `unavailable`, not a presumed match. Only a bounded
`consistent`/`mismatch`/`unavailable` status and number of compared items
are emitted; source IDs, matrix values and coordinates are not logged.

Unit tests deliberately keep instance-anchor spacing identical while changing
rotation or nonuniform scale, to ensure those changes are rejected. The real
isolated Chrome/WASM two-build synthetic Core 3MF acceptance test now requires
both linear-part consistency and the previously checked anchor spacing. No
published Pages behavior or WASM binaries are changed.

**Limits:** matching the unordered linear blocks is not an instance identity
mapping and does not establish which browser rotation belongs to which native
object. Component-local transforms, mesh world vertices, pivots, texture
materials, 3MF settings, desktop authoring behavior, full G-code parity and
print safety remain unverified. Browser edits are not exported as native 3MF.


## 2026-11-22: bounded ZIP preflight for opt-in native 3MF inspection

The read-only `inspectNative3mf()` localhost path now scans the 3MF ZIP central
and local headers **before** allocating a native WASM session. It rejects split,
ZIP64, encrypted, unsafe-path, duplicate-path, symbolic-link, unsupported-method,
inconsistent-length and malformed directory entries. The diagnostic caps archive
size at 8 MiB, member count at 512, any one expanded member at 64 MiB, and total
declared expansion at 128 MiB. Invalid input is rejected without exposing entry
names or invoking the native engine. Synthetic ZIP regression fixtures are tested
on CI; an isolated Chrome test exercises the existing real 3MF import path.

The synchronous ZIP envelope preflight independently checks STORED (method 0)
member CRC32. Since 2026-11-23, the isolated read-only inspector additionally
uses an **async bounded raw-DEFLATE (method 8) payload verifier** before it
allocates a native WASM session. It streams each compressed member, checking
its actual expanded byte count against the declared per-member size and
CRC32 against the central directory. Mismatched sizes/CRC, decoder failures,
and absent browser `DecompressionStream('deflate-raw')` support fail closed.
No inflated member payload or private member name is surfaced in the report.
Node regression tests cover legitimate compressed/streaming members, forged CRC,
corrupted payloads, understated expansion sizes, and decompression-bomb-shaped
inputs. The isolated Chrome gate exercises the existing end-to-end 3MF path.
This does not validate 3MF XML, eliminate every ZIP bomb or native parser
vulnerability, establish semantic preservation, or make G-code printable.
The published Pages app is unchanged; WASM remains limited to opt-in localhost.

## 2026-11-22: unique affine-frame offset gate (localhost only)

The read-only 3MF inspector now reports a **non-sensitive affine translation
frame classification**. For source-preserving Core build items with uniquely
matchable 3×3 native/Three.js linear transforms it distinguishes a common
global bed offset from an instance-dependent displacement. Duplicate or
near-identical linear transforms are explicitly ambiguous; unsupported
matrices are unavailable, and missing bijections are linear-mismatch.
The diagnostic does not inspect local native mesh vertices, expose arbitrary
project IDs, or change the imported scene. See
[V250_3MF_ROTATED_AFFINE_BROWSER_GAP.md](V250_3MF_ROTATED_AFFINE_BROWSER_GAP.md).

The synthetic rotated/nonuniform fixture's previously known anchor-spacing
mismatch must remain visible. Passing world-facet matching and a detailed
frame classification cannot establish desktop OrcaSlicer 3MF/G-code parity or
print safety; production Pages still does not load the experimental WASM.

## 2026-11-22: repeat-transform affine frame matching

The isolated, read-only 3MF inspector now disambiguates repeated native/Three.js
**linear** transforms only when there is exactly one bijection that also admits
one common global translation (0.05 mm tolerance). It does not use array order.
Repeated/coincident placements, absence of a common offset with multiple
linear assignments, or otherwise non-unique alignments remain `ambiguous`.
A unique linear assignment with non-shared translations continues to report
`instance-dependent`; no mesh-local vertices or native object identity are
inferred. The synthetic two-cube fixture now expects `common-offset` instead
of marking all repeated rotations as ambiguous. This is strictly a diagnostic
for localhost opt-in cross-origin-isolated sessions; the published Pages app,
engine artifact, G-code and printer safety remain unchanged.

## 2026-11-23: source-shared Core 3MF three-build diagnostic

The isolated Chrome/real v2.5.0 WASM test now generates a synthetic Core
3MF where **three differently transformed build items reference the same
source mesh**. Although native-converted world-space triangles agree with
the Three.js viewer (36 triangles), the official one-slicer-api manifest
reports three distinct internal meshes and objects. Consequently,
`auditNative3mfSharedMeshReframe` cannot legally classify all three
as a common native mesh merely because the source Core XML shared one
resource; it returns `insufficient-shared-instances` (zero eligible
shared-mesh instances). This is a newly observed normalization gap,
not a failed world geometry comparison.

The initial test that assumed three native instances must share one
manifest mesh failed on real Chrome (#45051023095). The regression now
asserts the observed native cardinality and the fail-closed classification
instead of labelling it a reframe hypothesis pass. Deriving an actual
native-to-source mesh association remains open; no editing, printing or
WASM production deployment was enabled.


## 2026-11-25: same-archive serialized infill config diagnostic (PR only)

The pinned upstream `src/libslic3r/GCode.cpp` emits a `CONFIG_BLOCK_START` / `CONFIG_BLOCK_END` section through `GCode::append_full_config`, based on `Print::full_print_config()` with some values adjusted or omitted. The pinned `PrintConfig.cpp` declares the 20 audited infill/layer/wall keys. The same-archive native/WASM CI now reports only allowlisted key names grouped by exact serialized equality, difference or absence; missing/duplicate/incomplete blocks are unavailable. No raw settings, arbitrary keys, G-code or filenames are reported. This does not inspect applied per-object/region settings, prove typed equivalence (e.g. 45 vs 45.0), or establish actual effective profile parity. The strict G-code comparison remains unchanged and still fails on mismatch; no public WASM activation or print safety claim. The next investigation is to use the observed difference/absence list to choose a specific effective-setting probe.


## 2026-11-25: distinguish missing serialized config from parser rejection (PR only)

The actual same-archive run [#45589182072](https://github.com/temesotejam/layer-workbench/actions/runs/45589182072) reported both config blocks unavailable; it did not establish whether the blocks were absent or rejected. Pinned `GCode.cpp` lines 3426, 4310–4320 and 4912–4929 gate emission on `gcode_skip_config_block`; `PrintConfig.cpp` declares that flag with a false default. The diagnostic now returns bounded parser status labels for each engine, plus the same input 3MF's explicit serialized skip flag status (missing/invalid/explicit enabled or disabled). It does not infer the engines' effective flag from the archive. The allowlist also adds the upstream-declared `internal_solid_infill_pattern`, `align_infill_direction_to_model` and `separated_infills`, making 23 keys. Unit tests cover malformed and absent blocks, skip-flag classification, and those geometry keys. No settings values, raw commands or arbitrary keys are printed; the strict ordered-command gate and public deployment are unchanged.


## 2026-11-25: physical-line handling in same-archive config diagnostic (PR only)

Run [#45604962126](https://github.com/temesotejam/layer-workbench/actions/runs/45604962126) passed the unit tests and native-only round-trip but both serialized config parsers returned `noncomment-in-block`; the source archive explicitly disables the skip flag. The actual offending line content is intentionally not logged. Pinned upstream [GCode.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/GCode.cpp) writes LF-delimited config records, and [Config.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Config.cpp) escapes CR/LF but not all Python splitlines separators. The independent audit now splits physical LF records, accepts CRLF and ignores only empty/space/tab records. Embedded CR, actual noncomment records, duplicates and missing delimiters still fail closed. New regressions cover blank records, CRLF, Unicode separators in unknown values and noncomment/duplicate rejection. Whether these changes resolve the real fixture rejection requires the new CI run. No strict motion gate, upstream code, candidate artifact or public deployment changes.


## 2026-11-25: sparse infill supporting-line attribution (diagnostic PR)

Run [45611707620](https://github.com/temesotejam/layer-workbench/actions/runs/45611707620) recovered all 23 allowlisted serialized config keys in both engines, all equal. The strict same-archive gate still failed (13,462 ordered mismatches; 4,091.04 mm unmatched sparse infill per side). This is not full effective configuration equivalence. Pinned upstream [FillBase.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Fill/FillBase.cpp) derives direction and reference center from layer and object/surface bounds; [FillRectilinear.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Fill/FillRectilinear.cpp) aligns lines to the rotated reference point. The CI-only comparator partitions unmatched sparse deposition length per side into absent exact direction at the same Z, absent supporting line despite a parallel direction at the same Z, and changed interval coverage on a shared supporting line. Existing exact lattice and multiplicity-aware sweep unchanged; no raw coordinates, angles, commands or profile values emitted. Exact-direction differences can reflect coordinate rounding; missing parallel lines do not prove phase shift or root cause. Regressions cover direction change, parallel displacement, clipping, split/reversed strokes, layer separation and absent tags. No gate relaxation, candidate rebuild, public activation or printability claim.


## 2026-11-25: distinguish shared-line spatial support from multiplicity (diagnostic PR)

Run [45616488632](https://github.com/temesotejam/layer-workbench/actions/runs/45616488632) failed the strict same-archive gate, but both sparse infill direction and supporting-line absence lengths were zero. All 4,091.04 mm unmatched on each side lie on shared supporting lines (720 differing groups; 91 observed sparse Z planes). All 23 allowlisted serialized settings still matched. This narrows the search to interval coverage rather than absent directions or lines, not proof of an engine root cause. Pinned upstream [FillRectilinear.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Fill/FillRectilinear.cpp) represents and sorts polygon-line intersections; [FillBase.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Fill/FillBase.cpp) handles boundary intersections and infill connections. The diagnostic now partitions shared-line unmatched traversal length into exclusive spatial support versus excess traversal on support present on both sides. Changed shared-line groups are counted by exact total length balance (integer projection per line) and exclusive-only/multiplicity-only/mixed difference. The sums are traversal lengths, not deposited volume; aggregate equality does not prove equal object/region assignment. Synthetic regressions cover equal-length displacement, repeat traversal, mixed differences, swapped input, disjoint supporting lines and reversed/split equivalent strokes. No raw coordinates, settings, or commands are reported. No gate relaxation, engine changes, candidate rebuild, public activation or printability claim.


## 2026-11-25: isolate axis-aligned versus oblique sparse exclusive support (diagnostic PR)

Run [45632918239](https://github.com/temesotejam/layer-workbench/actions/runs/45632918239) failed strict parity but classified all 720 changed shared sparse line groups as exclusive-only: 360 longer native, 360 longer WASM, none equal in total length and zero excess traversal on common support. Both sides have 4,091.04 mm exclusive length. The source-pinned CR-10 Standard process selects grid with 45-degree infill; [FillRectilinear.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Fill/FillRectilinear.cpp) implements FillGrid and connects multiline infill via the polygon boundary. [FillBase.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Fill/FillBase.cpp) implements contour connections. The synthetic source uses two axis-aligned cubes. The new CI-only diagnostic partitions exclusive traversal on shared sparse lines into axis-aligned and oblique lengths, and counts affected Z planes with exactly equal axis-aligned exclusive length per side on the existing integer lattice. Axis-aligned differences would support investigating boundary connections rather than the oblique grid strands; orientation alone cannot identify an anchor, boundary, object or internal engine function. The test covers both orientations, balanced and unbalanced Z planes and input reversal. No raw geometry/settings, strict gate relaxation, engine rebuild, public activation or printability claim.


## 2026-11-26: sparse infill single-ended anchor intervention (CI only)

Run 45637635895 measured 4091.04 mm of exclusive sparse coverage per engine, all axis-aligned, across 90 balanced planes; oblique exclusive coverage and shared-range excess traversal were zero. The 23 allowlisted serialized settings matched. Pinned [PrintConfig.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/PrintConfig.cpp) describes zero `infill_anchor` as disabling single-ended anchors; `infill_anchor_max` retains its original value (zero max would instead select the legacy connection algorithm). [FillBase.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Fill/FillBase.cpp) conditions limited perimeter hooks on positive anchor length. The new CI-only control copies the generated browser-edited project, changes exactly that one typed JSON setting, verifies every other member digest, and slices identical control bytes with the two engines. Both serialized output configs must confirm the change. Compare sparse coverage across engines and within each engine; the strict original comparison remains required and the control cannot hide a baseline failure. This is an experiment, not a fix or proof of effective settings; two-ended connections may remain. No raw projects or G-code are uploaded; no public engine changes.


## 2026-11-26: maximum anchor intervention after single-ended control (CI only)

Run [45654259596](https://github.com/temesotejam/layer-workbench/actions/runs/45654259596) verified the single-setting archive and serialized G-code changes in both engines. Sparse unmatched length per engine decreased from 4091.04 to 3798.00 mm, with 720 changed line groups in both cases. Single-ended anchors therefore do not explain the remaining difference. The native and WASM interventions each removed 592.592 mm of sparse coverage; the strict ordered gate still failed. Pinned [Fill.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Fill/Fill.cpp) clamps anchor length to maximum; [FillBase.hpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Fill/FillBase.hpp) defines dont_connect() as maximum below 0.05 mm, and [FillRectilinear.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Fill/FillRectilinear.cpp) uses chain_polylines rather than connect_infill for multiline Grid in this branch. The PrintConfig tooltip describes zero max as simple/old connection; this experiment does not assume all patterns or solid infill stop connecting. A third archive independently changes only infill_anchor_max from the first zero-anchor control, preserving all other members. Both engines must serialize the change; the original and both controls retain the strict comparison. Unit test covers independent max intervention and refusals. No upstream patch or candidate rebuild, raw artifact upload, public activation or printability claim.
