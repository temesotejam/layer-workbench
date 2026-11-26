# OrcaSlicer v2.5.0 desktop ↔ WebAssembly parity ledger

Updated: 2026-11-12 (JST). This is an **evidence ledger, not a declaration of parity**.

## Proven on CI candidate

Source: official OrcaSlicer `v2.5.0` checkout plus pinned Hiosdra/OrcaWasm `60a09e04f1990be39c8f6f35dffef1a2c9e224c4`, with the tracked v2.5.0 adapter. Latest engine [candidate run 43144590877](https://github.com/temesotejam/layer-workbench/actions/runs/43144590877) (2026-11-12 02:54–03:08 UTC) compiled and linked `slicer-mt.js` (148 KiB) and `slicer-mt.wasm` (30 MiB before ZIP compression). API 0.7.0 conformance, async binding, and Node smoke tests all passed. The [corresponding patch audit 43144590811](https://github.com/temesotejam/layer-workbench/actions/runs/43144590811) passed. [Artifact 13911536781](https://github.com/temesotejam/layer-workbench/actions/runs/43144590877/artifacts/13911536781) is a 9,027,864-byte ZIP, reported unexpired (expires 2026-12-12 03:08 UTC); upload SHA-256: `e0b15f85900600fd163fc055fd141f3907278fa89af41a78d0aec90c27ff0855`.

Verified tests include synthetic mesh and selected/all-plate slicing, G-code output, 3MF basic load/export, transforms and placement, arrangement, profile operations, support enforcer/blocker modifier behavior, async slicing/progress, cancellation, and a subsequent slice. These tests show **working headless core paths**, not desktop equivalence.

The earlier candidate reported `engine.version=2.4.2` from a hardcoded string in the pinned bridge. The adapter changed the capability string to `2.5.0` and CI now checks it before building. The latest candidate's runtime smoke test confirms `OrcaSlicer 2.5.0`. This remains a **metadata fix only**, not proof that all APIs or features were ported.

## Known gaps against the desktop

| Area | Evidence / limitation | Parity verdict |
| --- | --- | --- |
| wxWidgets desktop UI, viewport and Gizmos | `SLIC3R_GUI=OFF` headless WASM build | Not ported; browser UI separate |
| Full model editing (cut, split, boolean, lay-on-face, repair, face painting) | Current one-slicer-api 0.7.0 bridge lacks complete desktop editing surface | Not demonstrated |
| Texture-to-color and texture painting | `TexturePainting.cpp` and `TextureToColor/TextureToColor.cpp` excluded for WASM due to unported OpenCV | Unsupported in candidate |
| Texture displacement bake and UV editor | Desktop GUI and image/paint workflow not connected to a browser bridge | Not demonstrated |
| Parametric design/CAD | Build explicitly sets `SLIC3R_CAD=OFF` | Unsupported in candidate |
| Python desktop plugins | Embedded Python build disabled for headless WASM; no browser plugin host | Unsupported |
| Printer discovery, device management and cloud | Native OS services and desktop integrations not available through this engine | Not ported |
| Complete 3MF semantic round-trip | Basic cases tested; textures, paint attributes, opaque entries and all printer metadata not covered | Unknown |
| Exact desktop G-code equality | No same-source native v2.5.0 vs WASM golden comparison | **Not proven** |
| Browser deployment | `SharedArrayBuffer` requires cross-origin isolation; GitHub Pages/browser host not certified | **Not proven** |
| Version shown by capability JSON | Latest runtime smoke test reports `OrcaSlicer 2.5.0` and API 0.7.0 conformance passes | Verified metadata, not feature parity |

## Required acceptance tests before any “same as desktop” claim

1. Build unmodified desktop CLI from exact official `v2.5.0` commit, record the git SHA and compiler/dependency versions.
2. Feed identical STL, OBJ and 3MF projects with identical printer/filament/process profiles into desktop CLI and WASM; compare geometry, plate placements, slice statistics, and parsed G-code motion/extrusion/toolpaths. Normalize only nondeterministic timestamps and paths. Record numeric differences, not just exit codes.
3. Cover seams, bridges, overhangs, support-enforcer/blocker, adaptive layers, multi-material, multi-plate, intricate thin walls and stress/cancellation cases, plus v2.5.0 new features explicitly.
4. Round-trip real projects with opaque metadata, paint masks, texture assets and printer settings; inspect missing entries/attributes against native output.
5. Test editor functionality and rendering in an isolated browser, including pthread/SharedArrayBuffer, worker cancellation and large files; verify web-page integration separately.
6. Implement or explicitly mark missing desktop-only features unsupported. Do not claim functional equivalence while any key feature is missing.

## Release policy

A successful WebAssembly candidate with green CI is **a valid headless slicing engine candidate**. It is **not a feature-complete OrcaSlicer desktop replica**, and does not authorize publishing an unverified WASM build to the public site. Preserve upstream source, third-party notices and existing working deployment.

## 2026-11-12: G-code comparison harness

The repo now includes `scripts/compare_gcode.py` for deterministic ordered G-code command comparison and `scripts/test_compare_gcode.py` for its unit tests. [CI #43148106810](https://github.com/temesotejam/layer-workbench/actions/runs/43148106810) passed. It normalizes numeric formatting and ignores comments but retains every command in sequence, including extrusion, temperature and printer-specific commands. It emits JSON with raw input SHA-256 values and up to 15 first differences.

**Important:** comparator unit tests passing is not a native-vs-WASM parity result. No paired native and WASM files from identical model, profiles and options have been supplied to this comparator yet. The native official v2.5.0 output must be obtained from its CLI (or the official Linux release) using a documented pinned fixture before parity can be assessed. No unverified output is marked identical. Example:

```bash
python3 scripts/compare_gcode.py --native results/native.gcode --wasm results/wasm.gcode --report results/parity.json
```

The current strict comparator does not claim semantic equivalence of differently ordered but potentially functionally equivalent G-code; it will deliberately fail closed until a difference is reviewed.

## 2026-11-12 14:21 JST: Latest CI evidence refresh

The latest candidate #43144590877 remains successful; no newer candidate run or in-progress duplicate was present at this check. Its job logs explicitly show: API conformance **all pass** (engine creation, capabilities, project manifest, selected-plate G-code asset, profile application, conversion and error paths); binding **all pass** (async slice progress, cancellation and successful re-slice); smoke **all pass** (synthetic mesh, basic 3MF, native project/profile export, transforms/arrangement, support modifier changes and configured profiles). The five comparator **unit** tests also passed in #43148106810, but no native-vs-WASM same-input G-code parity run has occurred.

Current public-site [deployment #43157710791](https://github.com/temesotejam/layer-workbench/actions/runs/43157710791) and [browser Prepare static validation #43157686401](https://github.com/temesotejam/layer-workbench/actions/runs/43157686401) succeeded. These do **not** demonstrate the WASM engine running in-browser. The frontend uses Three.js and is not yet the full OrcaSlicer GUI.

Remaining release blockers: real browser tests of STL/OBJ/3MF + native project manifest, pthread/SharedArrayBuffer hosting, 3MF semantics/texture and paint metadata, native-vs-WASM G-code comparison on pinned inputs, UI/Gizmo behavioral parity, device/printing features, and optional CAD/plugin paths. No candidate WASM was deployed to the public site.

## 2026-11-13: fail-closed G-code comparison diagnostics

The strict comparator now refuses to report a match for two identical empty,
comment-only or non-motion inputs. Each side must contain at least one G0/G1/G2/G3
motion command; this is only an input sanity gate, not a slicer or print-safety
certification. Invalid UTF-8 is rejected instead of silently replacing distinct
corrupt bytes with identical replacement characters. The JSON report retains
the first 15 ordered command differences, counts **all** mismatching command
positions, and adds exact decimal WASM-minus-native parameter deltas when
numeric command words align. These changes do not weaken exact command checks.
The comparator's unit tests exercise these guards. **No native v2.5.0 vs WASM
paired golden-file comparison has been performed by these tests.**

## 2026-11-13: optional extrusion-fixture acceptance gate

The strict G-code comparator accepts `--min-extrusion-moves N` (default **0**, preserving the previous comparison behavior).
For native-vs-WASM *slicing* fixture checks, supply a threshold such as `--min-extrusion-moves 100` only after examining that fixture's expected extrusion count.
It requires each output to contain at least N G1/G2/G3 lines with a positive E word and an XY movement or arc radius/center; E-only priming, pure travels, retractions and zero E values do not satisfy the gate.
The JSON output reports `native_extrusion_moves`, `wasm_extrusion_moves` and `minimum_extrusion_moves`.
This is a limited syntactic check: absolute E values and firmware/modal behavior are **not** simulated, and matching counts do **not** imply correct deposition or machine safety.
It prevents an identical all-travel fixture from being accepted as a representative printed G-code parity test.
Existing exact ordered command checks remain unchanged. No paired official-native v2.5.0 vs WASM full-profile comparison has been performed.

## 2026-11-13: extrusion-state fixture gate correction

The optional `--min-extrusion-moves` gate now evaluates the **change in E** rather than treating every positive absolute E word as new extrusion. It handles `M82` (absolute E), `M83` (relative E), and `G92 E...` position resets; absolute-E retractions and relative-E negative moves do not increase the count. E-only priming updates the baseline without being counted as a deposition path. Four focused regression cases were added. Initial E mode is assumed absolute; tool switching, vendor-specific extrusion modes, E-unit conversion, and firmware side effects remain outside this simple fixture sanity check. **No native vs WASM official full-profile parity result is claimed.**

## 2026-11-13: reproducible paired-fixture manifest generation

The local CLI `scripts/make_parity_manifest.py` records SHA-256 digests for five **already generated** files in each of `native/` and `wasm/`: `model.stl`, `machine.json`, `filament.json`, `process.json`, and `gcode.gcode`. Each directory must contain its own input files, copied from the same fixed fixture. Example:

```bash
python3 scripts/make_parity_manifest.py --engine native --directory results/native
python3 scripts/make_parity_manifest.py --engine wasm --directory results/wasm
python3 scripts/check_parity_pair.py --native-manifest results/native/manifest.json --wasm-manifest results/wasm/manifest.json --min-extrusion-moves 100 --report results/parity.json
```

Generation is *not* G-code slicing; it verifies supplied files and cannot authenticate how they were produced. The upstream commit in this manifest is a declared pin, not a measurement of the actual binary. A genuine native-vs-WASM acceptance result additionally requires separately recorded CLI/binary hashes, toolchain provenance, exact slicer settings and real engine-generated G-code. The test suite uses synthetic fixtures and **does not establish G-code parity**. Never send this unvalidated G-code to a printer.

The manifest generator, strict comparator and command-line fail-closed cases
passed [CI #43339006849](https://github.com/temesotejam/layer-workbench/actions/runs/43339006849)
after restoring the optional extrusion gate argument in commit
[`ee6d841`](https://github.com/temesotejam/layer-workbench/commit/ee6d84125388f40c0ae09c5ac8c944784919c407).

## 2026-11-13: preserve actual browser-WASM G-code for paired comparison

The isolated Chrome probe now writes the **actual G-code bytes returned by the pinned WASM candidate** to `parity-output/wasm.gcode`, together with a summary containing the raw SHA-256, byte count, parsed layer count, extrusion-segment count and travel-segment count. The browser workflow archives this diagnostic output for 14 days. This makes the WASM side inspectable and reusable rather than only printing a transient console summary.

The fixture is still the synthetic 12-triangle cube with the browser probe's generic PLA development profile. It is **not** the selected official Creality/OrcaFilamentLibrary full profile, and no matching native CLI G-code is produced by this workflow. The artifact is diagnostic only and must not be sent to a printer. The next acceptance gate is a separately built, source-pinned native v2.5.0 CLI on the exact same STL/profile/options, with native binary and toolchain hashes recorded before using `check_parity_pair.py`.

## 2026-11-13: multi-material G-code audit for single-nozzle and multi-extruder workflows

Added `scripts/orca-multimaterial-gcode-audit.mjs` and a focused Node test. The read-only analyzer extracts Orca's CONFIG_BLOCK fields for `filament_map`, nozzle diameter, flow ratio, nozzle temperature, maximum volumetric speed, flush matrix, prime-tower enable/width and nozzle-volume type. It separately counts standard tool selectors (`T0..T255`), AMS-related `M620/M621/M620.1` commands, and prime-tower `M624/M625` markers. It classifies a repeated map to one physical nozzle separately from a map spanning multiple physical extruders. It rejects a map that references a non-existent nozzle and a non-square flush matrix.

The new tests include both a four-filament/single-physical-extruder fixture and a four-physical-extruder fixture. This prevents treating “four filament slots” as “four independent nozzles”. The parser is syntactic and vendor-aware only at the command-family level; it does not execute macros, infer AMS hardware identity, decode M624 payloads, interpret firmware state, or certify printer safety. User-supplied G-code remains local and is not copied into the public repository. GitHub Actions result for this latest commit is pending/unavailable at the time of this note.

### 2026-11-13: exclude X1E T255 filament-unload sentinel from material audit

The user-supplied X1E-style file contains a terminal `M620 S255`, `T255`, `M621 S255` unload sequence, separate from ordinary `T0` and `T3` selectors. The non-executable audit now records `commands.unloadToolSentinelCount` separately and excludes `T255` from `distinctToolIds` and normal tool-selection counts. `T1000` and `T1100` remain vendor/reserved commands and are not counted as regular material selectors. The synthetic regression fixture covers these commands. This classification is a bounded diagnostic convention, not a firmware toolchanger implementation. The user's real file is not committed to the public repository.


## 2026-11-13: archive-level 3MF preservation gate (not semantic round-trip parity)

A new read-only, standard-library comparator, `scripts/compare_3mf_metadata.py`, records a SHA-256 for each ZIP member **after decompression**, checks bounded ZIP member counts/sizes and unsafe names (traversal, duplicate entries, symlink, encrypted members), and rejects missing 3MF content-type and model parts. Its default `--scope all` reports added, missing and byte-changed archive members even if the ZIP order/compression differs. An explicitly requested `--scope metadata` compares only `Metadata/` members to diagnose whether Orca-specific metadata survived model edits; it never claims to check geometry, non-Metadata relationships, textures or other project contents in that mode. An empty metadata selection is rejected. Neither comparison is a semantic compatibility or print-safety proof.

The included synthetic unit tests exercise equal content in differently ordered ZIPs, changed/extra metadata, changed model geometry, path traversal, duplicate members and empty-metadata guards; a new lightweight workflow `test-3mf-parity.yml` runs them without rebuilding the WASM engine. A user-provided desktop-created project (retained outside the repository) was checked locally as an **input self-baseline**, with 15 archive files including project settings, per-object model settings, and object meshes. That self-check proves only the archive is readable, not that WASM preserved it or that desktop OrcaSlicer will open a rewritten copy.

Once the WASM candidate actually exports a 3MF from this same project, compare that output against the original and inspect changed members. For non-transforming import/export, first run `--scope all`; for intentional transforms, use metadata-only as a *diagnostic* and separately verify geometry, transform hierarchy and references. Never upload real user project bytes to public CI, and never treat a metadata-only match as full 3MF parity.

## 2026-11-13: real browser WASM 3MF archive round-trip gate

[Chrome run #43407690338](https://github.com/temesotejam/layer-workbench/actions/runs/43407690338) **PASS**. A real isolated Chrome instance used the pinned v2.5.0 WASM engine to export a synthetic one-object STL project to native 3MF, reimport it via the native project-profile API, verify a one-instance manifest, convert the 3MF to a binary STL with 12 triangles, and re-export the untouched project with `preservation:"require"`. The 3MF archive bytes matched exactly. `compare_3mf_metadata.py --scope all` on those actual engine-produced files also passed; the CI job archived the evidence. The test is in `scripts/test-browser-3mf-roundtrip.mjs`, invoked through `scripts/test-engine-probe.mjs`.

The first trial runs FAILED because the project mapped-preview API returns `UNSUPPORTED` (the candidate does not implement mapped STEP previews). This is now recorded as `mappedPreviewSupported:false`; **`threeMfToStl` is a flattened geometry conversion, not a mapped preview and not a project editing API**. No original desktop-created 3MF was round-tripped through this gate. Desktop reopen, metadata after actual edits, multi-object placement, and source model hierarchy parity are unverified. The initial synthetic archive is created by the engine being tested, so this proves self-consistency only. No public deployment of WASM or 3MF editor features was made.

## 2026-11-13: variant-index CI failure and source-backed fix

[Profile CI #43390845126](https://github.com/temesotejam/layer-workbench/actions/runs/43390845126) FAILED on `Ambiguous Orca variant fallback`, caused by a JS port that rejected two variant entries sharing the same extruder ID. Pinned `PrintConfig.cpp::find_variant_index` instead takes the first matching ID (or `-1` if none), while `get_config_index_base` clamps missing-ID `-1` to zero. This was fixed and tested. The next CI failure exposed a stale real-U1 assertion: the inherited official `extruder_variant_list` has four strings, each `Direct Drive Standard,Direct Drive High Flow`, rather than being absent. The test now asserts the pinned values. [Profile run #43408017939](https://github.com/temesotejam/layer-workbench/actions/runs/43408017939) **PASS**. No multi-nozzle WASM setting forwarding was enabled.


## 2026-11-13: inspect real WASM-exported 3MF core scene structure

Added a read-only core-scene auditor, `scripts/audit_3mf_scene.py`, following the
[3MF Core Specification](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md).
Unlike the earlier ZIP member-hash comparator, this parses `3D/*.model` XML to
inventory resource objects, direct mesh triangle/vertex counts, component
references, `<build>` items and their raw **12-number 3MF transform vectors**
without confusing 3MF row-vector matrices with native Orca/WASM transforms.
The existing ZIP inventory enforces size/path bounds first; malformed IDs,
unresolved component/build references, invalid triangle indices, DTD/entity
markup, nonfinite transforms and external-part build references fail closed.
Cross-part OPC relationships, assembly-cycle detection, textures, printer
settings, image preservation and native editing are NOT implemented here.
The report deliberately does not claim native/desktop semantic equivalence.

[3MF audit unit CI #43413108463](https://github.com/temesotejam/layer-workbench/actions/runs/43413108463)
**PASS**. [Isolated Chrome CI #43413188356](https://github.com/temesotejam/layer-workbench/actions/runs/43413188356)
**PASS**: after real WASM 3MF export and untouched preservation testing, the
new scene gate inspected the actual generated `.3mf` and verified exactly one
build item and at least 12 mesh triangles. It writes
`parity-output/browser-3mf-scene.json` to the CI-only diagnostic artifact.
The same Chrome run continues to check native 3MF-to-STL conversion and
existing Prepare/slice tests, while mapped face-ID preview remains unavailable.
The geometry/build verification is stronger than identical ZIP bytes alone,
but still uses a synthetic cube exported by WASM, not a desktop-created
multi-object project. Transform changes followed by native export, face-ID
mapping and desktop OrcaSlicer reopen remain outstanding.

## 2026-11-13: bounded same-part 3MF component instance and transform audit

To make the native 3MF → editable browser viewport acceptance gate more precise, `scripts/three_mf_instance_expansion.py` now expands *same-part* core 3MF component assemblies into concrete mesh instance diagnostics. `scripts/audit_3mf_scene.py` records per-instance build-item index, mesh resource ID, component ancestry, 3MF effective transform and referenced triangle count. It also reports totals for resolved mesh instances and their instanced triangles **separately** from unique resource mesh triangles, so two placements of the same mesh are not mistaken for one printable placement.

The transform composition follows the [3MF Core Specification §3.3](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md): 12-number row-major affine 4×4 matrices with row-vector application, where a child component's transform precedes its parent and the build-item transform. The source inspector does **not** pretend this is a native Orca/WASM matrix representation. Unresolved or external component parts, cycles (including unused cyclic resources), excessive nesting, transformed coordinate overflow and exponential instance expansion are rejected rather than flattened silently. Expansion is capped at 4096 mesh instances and 64 component levels, so valid but unusually large projects may be refused by this diagnostic.

[3MF lightweight CI #43418231408](https://github.com/temesotejam/layer-workbench/actions/runs/43418231408) **PASS** (4 archive-comparison + 4 integrated scene-audit + 6 composition/graph unit tests); existing Chrome source changes also trigger its browser probe but do not change the WASM engine or published application. A real browser-generated 3MF must still be treated as a self-consistency fixture, not a desktop-authored document. **Not demonstrated:** mesh face-ID preview, full import of desktop 3MF, applying a native transform edit, semantic settings/metadata preservation after edits, desktop reopen or multi-tool printing. This audit is an inspection aid and does not certify printer-ready output.

## 2026-11-13: 3MF scene vertex bounds and conservative instance extents

The read-only `audit_3mf_scene.py` now validates all core mesh vertex
`x/y/z` coordinates as present, finite and within a diagnostic magnitude
limit, instead of accepting NaN/Infinity or missing coordinates simply because
triangle indices were in range. For each mesh resource it records local vertex
axis-aligned bounds. The existing same-part component/build expansion now
applies the **3MF row-vector** transform to the eight corners of those local
bounds and reports `conservativeWorldBounds` for every resolved mesh instance.
This reports a guaranteed enclosing AABB, **not** the exact post-rotation
vertex AABB or a viewport rendering; quantities remain in the model's source
coordinate unit, not assumed millimetres. Empty vertex lists report null
bounds; extreme transformed coordinates are rejected.

Added rotated/translated, repeated-placement and malformed-vertex regression
coverage. This is a safety/geometry-inspection step toward comparing a
native 3MF scene with a future WebGL viewport; it neither implements 3MF
editing nor proves parity with desktop OrcaSlicer. The pinned WASM candidate
and the published application remain unchanged.

## 2026-11-13: source-unit-aware 3MF viewport extent diagnostic

The read-only scene audit now validates the 3MF Core `model/@unit` enumeration
(`micron`, `millimeter`, `centimeter`, `inch`, `foot`, `meter`),
with the specification's default of millimetres when omitted
([3MF Core §3.3](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md)).
It exposes each model part's `unit` and `millimetersPerUnit`, and adds
`conservativeWorldBoundsMm` for every resolved mesh instance. Original
`transform3mf`, `localBounds` and `conservativeWorldBounds` retain their
**source-file units**; no native transforms or mesh files are rewritten.
Unknown units and excessive normalized world bounds fail closed.
This avoids treating a 1-inch cube as a 1-mm cube in a future viewport
comparison. It is still a conservative AABB inspection, not a native
WebGL/OrcaSlicer geometry or machine-printing parity result.

## 2026-11-13: actual WASM 3MF-to-STL geometry comparison gate

A new read-only `scripts/check_3mf_stl_bounds.py` and unit suite compare the **actual** converted STL from isolated Chrome `threeMfToStl()` with the original WASM-generated core 3MF. The script derives **exact used-triangle bounds** after same-part component/build transforms, converts the 3MF model unit into millimetres, and checks placed triangle count and global XYZ extents against binary STL vertices with 0.05 mm tolerance. This is not a comparison of conservative boxes: rotation and nontrivial parent transforms are covered in regression tests. The Chrome probe now archives both the actual 3MF and conversion STL plus a JSON deltas report. The gate rejects missing or non-finite STL vertices, excessive triangles and multi-part scenes outside supported cross-part semantics. Even if it passes, it is self-conversion of a synthetic cube, **not** a desktop-authored 3MF acceptance test, complete mesh correspondence, face-ID mapping, metadata parity, GUI rendering or print certification. The public page and engine build remain unchanged.

## 2026-11-14: fail-closed 3MF → STL interior-vertex diagnostic

The previous `check_3mf_stl_bounds.py` acceptance gate compared placed
triangle counts and exact global XYZ bounds, which could incorrectly accept
a deformed interior vertex without changing the overall bounding box.
It now also compares the **sorted per-axis coordinates of every placed triangle
vertex** (including repeated vertices), using the same explicit millimetre
tolerance as the bounds check (default 0.05 mm). Sorting makes the test
independent of triangle order, vertex order and winding; source triangle
instances are expanded and transformed before comparison. The STL and expanded
3MF remain subject to the 200,000-triangle diagnostic limit.

A regression now deliberately moves one vertex 0.5 mm while preserving the
triangle count and the entire XYZ bounding box: the new gate **fails**, while
reordered/winding-reversed triangles and float32 rounding below tolerance
**pass**. The JSON report includes
`axisDistributionDeviationsMm` and
`maxAxisDistributionDeviationMm`. A count mismatch fails without attempting
an axis-rank comparison.

[3MF unit tests #43462674350](https://github.com/temesotejam/layer-workbench/actions/runs/43462674350)
**PASS**, and the
[real isolated Chrome/WASM integration #43462674348](https://github.com/temesotejam/layer-workbench/actions/runs/43462674348)
**PASS** on commit `5e4d60e`. This validates the existing WASM-generated
synthetic 3MF-to-STL conversion more strictly, not native desktop compatibility.
Independent XYZ multisets are **not** a full correspondence/topology proof:
vertex positions can be exchanged between triangles without changing any
axis-wise multiset. Face IDs, 3MF settings, edited-project export and native
desktop round-trip are still unverified. Do not use this check to certify
printer-ready G-code.


## 2026-11-14: real browser two-object 3MF export reveals a hierarchy-preservation gap

The isolated Chrome test now starts from **two separate, synthetic 12-triangle STL
objects** with independently supplied project instance IDs and different X
positions. The original WASM `setObjects` session reports **2 meshes, 2
objects and 2 instances**, and native `project.3mf` export succeeds.
The archive's actual flattened native `threeMfToStl` result retains **24
triangles**, spatially divided into **12+12 disjoint mesh clusters**, and
the read-only 3MF/STL geometry checker reports **0.0 mm** max coordinate
deviation (0.05 mm allowable tolerance).

However, **the exported 3MF does NOT preserve the original two-object
hierarchy**. The measured archive has **2 resource records but only 1
`<build>` item**, a **single combined 24-triangle mesh resource** (plus
one component wrapper), and the new native `initProfile` /
`getManifest` sequence reports **1 object and 1 instance**. The
single placed mesh spans X=88..168 mm in the exported model. Therefore
the two original movable objects have become a single assembly/mesh for
the tested export path. The correct result is **geometry retained,
object/instance editability lost**. Source API instance translations
are not preserved as two independent native build transforms.

The first strict two-object round-trip gate
[Chrome CI #43467971644](https://github.com/temesotejam/layer-workbench/actions/runs/43467971644)
**FAILED** specifically on the loss of distinct imported instances.
After inspecting the failure rather than disguising it, the test was
changed into an explicit **capability-gap diagnostic**: it checks
that two source objects and both 12-triangle spatial clusters exist,
records `multiObjectRoundTripSupported:false`, and leaves future
native hierarchy preservation as a separate unsatisfied acceptance
criterion. [Chrome CI #43468246862](https://github.com/temesotejam/layer-workbench/actions/runs/43468246862)
**PASS** as a diagnostic; **not** a multi-object round-trip parity PASS.

This is a synthetic WASM-authored input, not a desktop-created 3MF.
There is still no verified mapped face-ID preview, native transform
editing on a reimported project, preservation of desktop metadata,
native G-code parity or printer-safe output. The targeted next change
is to inspect and repair the v2.5.0 WASM native export/import model
hierarchy path, while keeping the already-built engine isolated from
public Pages until that bridge and its tests are validated.


## 2026-11-14: opt-in native 3MF plate-origin viewport mapping (experimental)

The existing public Prepare viewer previously auto-centered every imported file,
including 3MF. That erased the absolute plate placement when the 3MF
`<build>` already carries translations. The isolated localhost
`?engineLab=1` viewport now keeps the ThreeMFLoader-provided build transforms,
mapping only the native 256 mm plate origin by (-128, -128) in X/Y; it does
**not** lower the original Z geometry to zero or independently center components.
The normal public viewport behavior is unchanged.

The same pinned WASM two-cube exported 3MF fixture used in the native API
diagnostic is loaded into the actual browser WebGL viewer by a new Chrome
acceptance check. The isolated read-only `__layer3mfViewportAudit` reports
the imported scene bounds and verifies the 80 mm X extent and the two separated
regions around the centered plate; it is inaccessible without isolated
localhost and explicit `?engineLab=1`. Actual [isolated Chrome CI #43478647654](https://github.com/temesotejam/layer-workbench/actions/runs/43478647654) **PASS**; the job log contains the explicit `PASS: isolated 3MF viewport native build placement` assertion. [Public Prepare Chrome smoke #43478647657](https://github.com/temesotejam/layer-workbench/actions/runs/43478647657), [static validation #43478647860](https://github.com/temesotejam/layer-workbench/actions/runs/43478647860), and [Pages deployment #43478647579](https://github.com/temesotejam/layer-workbench/actions/runs/43478647579) also passed. These success results are limited to the tested synthetic scene and existing smoke; not full 3MF parity. This is only **viewport geometry placement**.
The current native exporter merges the two source objects, and the browser
still imports the 3MF as one selectable entry; there is **no proof of native
multi-object editability, arbitrary desktop 3MF metadata preservation, full
3MF model coordinate semantics, native transform editing, save/reopen, or
G-code parity**. The published page does not load WASM automatically.

## 2026-11-14: local per-build-item 3MF viewport selection (staged)

In the isolated localhost `?engineLab=1` diagnostic, the Three.js r180
`ThreeMFLoader` project root exposes a child per 3MF Core `<build>` item.
The local viewer now creates **one selectable entry per top-level build item**
without flattening component descendants, re-centering individual objects,
or changing the source archive. Numeric X/Y/Z movement, rotation and scale
are **browser scene edits only**; deletion of one entry leaves its sibling
in the viewport. Inputs with no renderable build geometry or more than 64
items fail closed. Public normal-mode imports stay grouped as before.
The engine-lab panel now loads only on isolated localhost with explicit opt-in.

An independent, deterministic, synthetic Core 3MF fixture has **two build
items** for the same cube resource at native X=90 and X=150 mm. CI first checks
its source structure using `audit_3mf_scene.py`, then the actual Chrome
viewport checks two separately selectable meshes, individual world bounds,
a +5 mm edit of only the second viewer item and selective removal. This
does NOT repair the WASM candidate's observed two-object native 3MF export
collapse (2 objects → 1) or provide native project transform/save parity.
No desktop-created project, metadata preservation, mapped face IDs or real
printer G-code is certified by this test.

## 2026-11-14: staged native 3MF object-preservation patch (not yet a verified engine)

The observed native WASM 3MF export path merged all manifest instances into a
single binary STL mesh before writing a 3MF. A **fail-closed patch candidate**
in `scripts/patch-orcawasm-3mf-object-export.py` now replaces only that
pinned export branch, constructing a separate native `ModelObject` for each
manifest instance via the existing `build_project_plate_model` bridge helper,
then invoking `write_project_model_3mf`. The desktop upstream source is left
untouched, and the patch is **not** applied to the published application.

The patch's three unit tests exercise the exact branch, reject changed/duplicate
anchors and reject a second application. The lightweight audit clones the pinned
OrcaWasm source, validates these anchors, and applies the patch in a disposable
checkout. This is **source-path preparation only**: correctness, object hierarchy
on exported files, runtime errors, metadata, and desktop compatibility cannot
be declared until a **new** candidate WASM build, isolated Chrome multi-object
round-trip, and desktop-created 3MF comparisons pass. The previously verified
WASM candidate #43144590877 is unchanged.

## 2026-11-14: isolated Chrome acceptance for newly rebuilt native 3MF candidate

A separate `verify-native-3mf-candidate.yml` workflow now triggers **only after a successful** `Build v2.5.0 WebAssembly candidate` run, downloads the artifact from that exact run, and uses `scripts/test-candidate-browser-3mf.mjs` in isolated Chrome. The strict gate requires two native objects, two reimported instances, 24 retained triangles and separate placements, followed by independent Core 3MF structure and STL geometry diagnostics. It cannot silently downgrade a hierarchy failure into a diagnostic PASS. The existing browser integration workflow remains pinned to the previous known-good candidate #43144590877. The new workflow does not publish any candidate to the Pages app. This is an **acceptance plan, not a passed runtime test** until the new candidate has finished building and the downstream Chrome workflow reports success. Desktop-created 3MF, metadata parity, full native G-code parity and print safety remain separate unverified gates.


## 2026-11-14: rebuilt 3MF exporter compiles; independent smoke regression blocks release

[Candidate run #43502341006](https://github.com/temesotejam/layer-workbench/actions/runs/43502341006)
**FAILED** after the experimental per-instance 3MF exporter **compiled and linked**
successfully (339/339 build steps, 30 MiB `slicer-mt.wasm`). Its pinned
OrcaWasm `build-local-wsl.sh` then ran its embedded smoke suite and reported
**one functional failure**:
`support-enforcer did not change support output from the automatic-support baseline`.
The remaining smoke cases displayed in the log passed, but that does not erase
this failure. The smoke suite exited with code 1, so the build job was FAIL,
no verified candidate WASM artifact was released, and the downstream Chrome
verification was skipped. The exporter patch's native multi-object runtime
assertions were **not reached**. This is not a C++ compile failure and must not
be reported as a verified multi-object fix. The relationship between this
support-enforcer failure and the exporter change is not yet established.

To obtain independent evidence without weakening that smoke assertion, the
candidate workflow now validates the **exact pinned terminal smoke invocation**
in the disposable OrcaWasm builder script, removes only that embedded duplicate,
then runs the *unchanged* upstream `scripts/smoke-test.mjs` once in its
existing fail-closed CI test step. If the source trailer drifts, the workflow
stops instead of silently removing a different block. The multi-object 3MF
runtime test explicitly runs when compilation succeeded, even if the separate
smoke gate failed. No artifact is released from a failed job. The heavy WASM
build is still triggered only for source/CI changes, not for documentation or
routine monitoring. This change is **test orchestration only**, not a confirmed
engine or UI behavior fix.

See [workflow commit dca4cc4](https://github.com/temesotejam/layer-workbench/commit/dca4cc472e9f92ba93464ddb6d4d9c050f327959)
and [new candidate run #43505545279](https://github.com/temesotejam/layer-workbench/actions/runs/43505545279).
At the time of this note the new run has not yet established the strict
two-object hierarchy acceptance result. Follow-up: read its native export test
and smoke logs separately, investigate the support-enforcer assertion if it
still fails, then require isolated Chrome and desktop-created 3MF fixtures
before changing the candidate's release status.

## 2026-11-14: independent 3MF hierarchy gate passes; support smoke still blocks release

[Rebuilt candidate #43505545279](https://github.com/temesotejam/layer-workbench/actions/runs/43505545279)
completed as **FAIL**. C++ build, API 0.7.0 conformance and asynchronous
binding checks passed. Importantly, the previously unreachable independent
native 3MF regression now ran and logged
`PASS: rebuilt candidate preserves two native 3MF objects, two instances, 24 STL triangles`.
That is direct **Node/WASM evidence for the synthetic two-object case**,
NOT a clean candidate release or an isolated Chrome result. No artifact was
released; the downstream workflow was skipped.

The one blocking test was the original support modifier scenario, again
failing on `support-enforcer did not change support output from the
automatic-support baseline`. The same pinned smoke source passed twice
against the earlier candidate #43144590877, so an engine regression cannot
be excluded. Inspection of the pinned test found its generic-PLA test
configuration set `support_type` and `support_threshold_angle` but did
**not explicitly set `support_enable`**. The separate Voron modifier
fixture explicitly enables supports and passed. This is a plausible source
of test sensitivity, **not yet a proven root cause**.

The next candidate stages a small fail-closed patch to **only the smoke
fixture setup** in the disposable pinned OrcaWasm checkout, adding
`support_enable: 1`. It retains the original strict requirement that
support-enforcer and support-blocker actually change sliced G-code relative
to baseline; no assertion or C++ engine behavior is weakened. Both the
lightweight audit and candidate build unit-test the exact anchor and reject
source drift. If this still fails, treat it as a real functional regression
and investigate the native support-modifier pipeline, not as permission
to skip the smoke gate. The experimental 3MF export patch is unchanged,
and WASM is not published. An isolated Chrome acceptance and desktop
3MF comparison remain required even if the next candidate passes.

## 2026-11-14: object-preserving 3MF candidate and strict absolute placements verified in Chrome

The experimental exporter candidate [build #43517364379](https://github.com/temesotejam/layer-workbench/actions/runs/43517364379) **PASS** (API conformance, asynchronous binding, generic support modifier smoke, independent native two-object export). Explicit `support_enable: 1` in the *test fixture* resolved the previously blocking support-enforcer smoke failure **for this candidate**; it does not by itself establish a general support-modifier correctness proof. The binary is not deployed to the public site.

The corresponding [isolated Chrome workflow #43519230388](https://github.com/temesotejam/layer-workbench/actions/runs/43519230388) **PASS**, requiring two native 3MF objects, two reimported instances, 24 retained triangles and a matching 3MF/STL geometry diagnostic. Stronger per-object XYZ assertions subsequently ran on the same successful **pinned** candidate without repeating the heavy engine build: [placement check #43526517692](https://github.com/temesotejam/layer-workbench/actions/runs/43526517692) **PASS**. Its synthetic 20-mm cubes are verified individually at X=90..110 and X=150..170 mm, Y=90..110 mm, Z=0..20 mm, tolerance 0.05 mm. This goes beyond the earlier 60-mm centroid-separation check by checking absolute plate coordinates and both bodies independently.

The **older** approved-to-date isolated WASM binary (#43144590877) instead returned X=88 mm for the first cube in this stronger comparison, causing [legacy verification #43526450440](https://github.com/temesotejam/layer-workbench/actions/runs/43526450440) to **FAIL** when the new strict assertion was initially applied to both generations. This does *not* show a regression in the rebuilt exporter. The Chrome test now has explicit `requireExactPlacement` behavior: the legacy workflow retains its earlier geometry/hierarchy-gap diagnostic and reports whether exact placement matches, whereas the accepted-candidate workflow **must** reject any deviation greater than 0.05 mm. Do not interpret a legacy diagnostic PASS as newly validated absolute-placement support.

**Still unverified:** desktop-authored OrcaSlicer 3MF round trips, project metadata/profile preservation, native transform editing after reimport, true mesh/face identity, same-full-profile desktop-vs-WASM G-code, multi-extruder support, production deployment and actual printer safety. The next feature milestone is independent edit-and-resave of one imported object through an upstream-native model transform API rather than rebuilding a flattened STL or modifying only the Three.js scene.

## 2026-11-14: isolated native manifest instance edit → 3MF export/reimport gate

A new strictly scoped test now edits the **second** 0.7.0 project manifest
instance (Z 90° rotation, 1.5 nonuniform scale and translation) while leaving
the first instance unchanged. It sends the original two synthetic STL blobs
and edited manifest to the *existing* `session.setObjects` API, exports the
new rebuilt v2.5.0 WASM candidate's native `project.3mf`, reimports that file,
and independently checks 2 objects, 2 instances, 24 triangles and exact XYZ
bounds of both bodies (0.05 mm tolerance). The source geometry is never edited
in Three.js or flattened into one object for this test. The CI archives the
actual edited 3MF, converted STL and diagnostic report, and validates their
core structure and STL geometry using the existing read-only Python tools.

**Critical scope limit:** This uses `setObjects` to replace a session whose
source is *two synthetic STL blobs*. It is **not** a native instance-transform
mutation on a project loaded via `initProfile('project.3mf',...)`, and cannot
preserve its opaque metadata; the source is neither desktop-authored nor
print-ready. The pure JS transform adapter rejects missing/duplicate IDs,
non-finite/singular/perspective matrices and oversized inputs. Its acceptance
workflow reuses candidate artifact #43517364379 and does **not** rebuild the
heavy C++ engine, enable WASM on Pages, or claim desktop editing parity.

Next blocker: expose and verify a native bridge operation that can apply a
selective transform directly to an **imported** 3MF project while reporting
whether settings, per-object metadata and non-native archive entries can be
preserved. Do not conflate manifest replacement with lossless 3MF editing.

**Verified outcome (2026-11-14 JST):** [isolated accepted-candidate Chrome run
#43528571920](https://github.com/temesotejam/layer-workbench/actions/runs/43528571920)
**PASS** for the new browser-native manifest edit test and existing strict
placement test. The browser wrote a two-object native edited 3MF, reimported
2 objects / 2 instances, retained 24 triangles, and satisfied the independent
per-object STL bounds checks: unchanged first cube X=90..110 mm, changed second
cube X=145..175 mm (local Y scale 1.5 with 90° Z rotation), both within
0.05 mm of their expected XYZ bounds. The workflow also archived the edited
3MF/STL pair and structural/geometry reports. Candidate source and WASM binary
were unchanged; the published Pages app did not enable the experimental engine.

The initial test run [#43528453883](https://github.com/temesotejam/layer-workbench/actions/runs/43528453883)
**FAIL** because a Node assertion object was unavailable inside Playwright's
browser evaluation context. It was replaced with browser-local fail-closed
assertions in commit `d75083f`; the rerun passed. That test-harness error did
not indicate a confirmed native-export defect. The remaining imported-3MF
native editing and metadata-preservation acceptance criteria above are **still
unmet**.

## 2026-11-14: independently generated 3MF Core -> actual WASM native import gate

An **independent Core 3MF fixture** generated by
`scripts/make_3mf_two_build_fixture.py`, rather than by the WASM exporter,
was newly passed to the accepted v2.5.0 candidate inside COOP/COEP-isolated
Chrome. It has one shared 20-mm cube resource and **two separate build
placements** at X=90 and X=150 mm. This probes native imports from outside
the engine's self-generated project archives, without using real user
files or claiming compatibility with OrcaSlicer desktop metadata.

[First Chrome run #43536942667](https://github.com/temesotejam/layer-workbench/actions/runs/43536942667)
**PASS**: `threeMfToStl` yielded 24 triangles, correctly placed at
X=90..110 and X=150..170 mm, and `initProfile('project.3mf', bytes)`
accepted this externally generated Core file. The native manifest reported
API 0.7.0, 2 meshes, 2 objects, 2 instances and 1 plate. An untouched
`preservation:'require'` export was **byte-identical** to the 1052-byte
input archive. Its STL coordinates were also checked using the independent
`check_3mf_stl_bounds.py` diagnostic.

The exploratory result is now promoted to **strict assertions** in the
accepted-candidate Chrome regression test, reusing the already successful
WASM artifact (#43517364379) with no heavy rebuild. Source file and
diagnostic report remain in CI-only evidence; no WASM binary is added to
Pages. Unsupported imports and preservation failures will now fail this
acceptance gate instead of being quietly reported as success.

**Still NOT established:** desktop OrcaSlicer-authored full 3MF compatibility,
modified-then-preserved archive metadata, transformations on a project
already loaded via `initProfile`, component hierarchy beyond the tested
Core fixture, arbitrary printer profile retention, G-code parity or
print safety. Next implementation step is an upstream-native, transactional
instance transform operation for imported project state, together with
metadata and object-identity comparison on re-export.

**Strict acceptance follow-up:** [Chrome run #43537269103](https://github.com/temesotejam/layer-workbench/actions/runs/43537269103)
**PASS** on the pinned native candidate. In addition to the earlier
diagnostic observations, the test now actively FAILS if independent Core
3MF import rejects the file, changes the two-object/two-instance native
hierarchy, produces wrong STL geometry, or fails untouched byte-for-byte
preservation. This still does not exercise imported-object mutations.

**Pages CI reliability note:** [deployment #43537269008](https://github.com/temesotejam/layer-workbench/actions/runs/43537269008)
failed even though upload succeeded. The deploy action initially saw zero
`github-pages` artifacts, and a failed-job rerun uploaded a second artifact
with the same name, leading to a duplicate-artifact error. The deployment
workflow now separates artifact upload and deployment into dependent jobs.
This is CI orchestration only; the published app and WASM release policy are
unchanged. New deployment results must be checked before declaring the
hosting issue resolved.


## 2026-11-14: proposed fail-closed safety guard for imported 3MF replacement

Source audit of pinned OrcaWasm \`oneslicer_project_set_objects\` found a
metadata-preservation false-positive: importing a 3MF retains source ZIP bytes,
but subsequent \`setObjects\` **clears** those bytes and sets
\`native_project_dirty=false\`. A later \`export("project.3mf",
{preservation:"require"})\` can then succeed even though the imported
project was discarded. Similarly, an imported project with a dirty manifest
but no unrecognized ZIP entries is not inherently losslessly regenerated.

The staged, pinned-source-only bridge patch adds a sticky
\`native_project_replaced\` bit until \`reset_project\`, and refuses
\`preservation=require\` after imported-project replacement **or** dirty
native project mutation. \`preservation=best-effort\` remains possible after
replacement but emits an explicit \`native-project-replaced\` data-loss
warning. This does not recover discarded metadata, expose a native
instance-transform operation, or validate desktop-authored projects.

The new isolated-Chrome regression starts from the independently generated
two-build Core 3MF. It asserts a byte-identical untouched export, replaces
the imported project with a synthetic single cube using \`setObjects\`,
requires strict preservation to **reject** that destructive action, and
requires a best-effort data-loss warning. The test is only enabled on the
**new rebuilt candidate** via \`CHECK_REPLACEMENT_GUARD=1\` and is not
applied to the previously accepted #43517364379 binary. No WASM is
enabled on the public Pages build. Audit, build and Chrome statuses must
be checked from GitHub Actions before treating this safety patch as verified.


## 2026-11-14: independently gated rebuilt-WASM imported-3MF preservation regression

[Candidate build #43543086458](https://github.com/temesotejam/layer-workbench/actions/runs/43543086458)
**FAIL** in the *generic support-enforcer smoke test*, despite successful C++ compile,
API conformance, asynchronous binding checks, and the independent **two native
3MF objects / two instances / 24 STL triangles** regression. Adding an explicit
`support_enable: 1` to that pinned smoke fixture did not resolve the lack
of a G-code change; this is **not** evidence that the imported 3MF preservation
guard fails. No candidate WASM artifact was approved/uploaded and the dependent
isolated Chrome workflow was skipped. Do not weaken the smoke assertion or
describe this build as green.

Added `scripts/test-v250-imported-replacement-guard.mjs` as a **separate strict
Node/WASM runtime gate**, called immediately after compilation and before the
potentially failing support-modifier smoke. It consumes a *fresh, independently
generated Core 3MF with two build placements* (not desktop-authored), verifies
the byte-identical untouched `preservation=require` export, intentionally
replaces it with a one-object synthetic STL using `setObjects`, demands a
specific strict-preservation refusal, requires
`warnings[].code = native-project-replaced` for best-effort export, and
checks that re-importing a fresh clean project resets the sticky guard.
A JSON-only report is archived even when an unrelated smoke step fails;
the unapproved WASM binary is **never** archived by this report step.

The smoke step is now independently gated on completed compilation rather
than the earlier guard's pass, so both failures are visible. The build job
still FAILS when either guard or smoke fails, and the Chrome acceptance
workflow still requires a fully successful candidate build. These are new
test/CI changes, **not yet an observed PASS for the new guard test**.
The next build's specific runtime outcome must be inspected before approving
or attempting broader 3MF metadata editing. No public production feature,
printer G-code, or metadata-lossless edit is enabled by this change.

## 2026-11-14: rebuilt 3MF preservation guard — successful Chrome acceptance

The newly patched OrcaSlicer v2.5.0 WASM [candidate build #43547498902](https://github.com/temesotejam/layer-workbench/actions/runs/43547498902) **PASS**: C++ build, API conformance, asynchronous binding, independent imported-Core-3MF replacement guard, support-enforcer/blocker smoke and the two-object native 3MF export regression. The imported guard's Node execution explicitly confirmed that a clean import can be exported byte-identically with `preservation=require`, that `setObjects` replacement causes a strict refusal, that `best-effort` returns a `native-project-replaced` data-loss warning, and that importing a new clean 3MF resets that state.

The follow-on [isolated Chrome acceptance #43549216937](https://github.com/temesotejam/layer-workbench/actions/runs/43549216937) initially **FAIL** at an acceptance-*harness* dependency: the separate Chrome job tried to open `parity-output/independent-core-two-build.3mf` even though this fixture was created only in the earlier build job and was not part of its artifact. The previously completed browser checks of two separate objects, 24 triangles, exact placements and transform/edit/reimport had already passed. No WASM failure was established by this missing-file error.

Commit [`76d4330`](https://github.com/temesotejam/layer-workbench/commit/76d43308a4539b369525901d0eae664620df3961) updates `scripts/test-candidate-browser-3mf.mjs` to regenerate the deterministic, independent synthetic Core fixture **inside the Chrome test job** using the pinned local Python generator, then reject an empty/non-ZIP file before sending it to the engine. No fixture is published or downloaded from an untrusted URL. This does not change the engine or production UI and therefore did **not** trigger a heavy candidate rebuild.

A targeted **rerun of the failed Chrome job only**, using the exact previously successful WASM artifact, passed in [#43549216937, attempt 2](https://github.com/temesotejam/layer-workbench/actions/runs/43549216937). The log explicitly includes: independent Core import with two objects/two placements and correct bounds, untouched byte-identical source archive export, imported-project replacement strict refusal, and the best-effort metadata-loss warning. The independent accepted-candidate Chrome regression [#43554148587](https://github.com/temesotejam/layer-workbench/actions/runs/43554148587) and Pages [#43554148585](https://github.com/temesotejam/layer-workbench/actions/runs/43554148585) also passed after the script change.

**Still not demonstrated:** native in-place mutation on an *imported* 3MF (without destructive `setObjects` replacement), desktop-authored full-project 3MF compatibility, opaque metadata preservation after editing, native desktop versus WASM full-profile G-code parity, or a production-isolated browser host. A successful strict **refusal** to discard metadata is a safety improvement, not lossless editing. The public Pages app still must not enable unverified WASM slicing.

## 2026-11-14: strict placed-triangle membership diagnostic

The independent read-only `check_3mf_stl_bounds.py` now compares **sorted
3D vertex triples within each placed triangle** (and then sorts triangles),
in addition to existing triangle count, AABB and independent per-axis vertex
coordinate distributions. It reports `maxTriangleVertexDeviationMm` and
fails if the new deviation exceeds the explicit millimetre tolerance.
The new regression swaps complete XYZ vertices **between** two triangles:
the old AABB and axis-distribution checks would both pass at zero error,
but the changed triangle membership must now FAIL. Winding and triangle order
remain intentionally irrelevant. The 200,000-triangle diagnostic cap remains.

This sorted, tolerance-based comparison can conservatively reject near-tied
vertices whose ordering changes under floating-point rounding; it does not
prove indexed mesh topology, face/vertex identity, normals, material metadata,
desktop OrcaSlicer parity or print safety. It is a stricter WASM 3MF→STL
regression gate, **not** a native G-code comparison. CI execution results for
this patch must be checked separately; success must not be presumed.

## 2026-11-14: fail-closed G-code preview word parsing

The localhost-only experimental G-code 2D/3D preview now validates **all** of
each G0/G1/G2/G3/G92 movement's numeric words before changing its modal XYZE
state. Previously, a global regex could accept `X10` from the malformed
`G1 X10oops Y5 E1`, silently drawing a credible but incorrect extrusion.
Malformed, duplicate, checksum-bearing, and unsupported-axis commands are
omitted as an entire movement and counted as `skippedMalformedMotion`; a
subsequent valid movement retains the last valid endpoint. Feedrate and common
nongeometric numeric F/S/P fields are parsed but not interpreted. Compact
`G1X10Y20` and `N15G1X20` are supported. To avoid an ambiguous compact
`X1E2`, exponential values require signed exponents such as `X1E+2`.

This is conservative diagnostic rendering, not validation of arbitrary
printer firmware G-code syntax or safe toolpath reconstruction. In particular,
checksummed input is omitted rather than accepting unchecked checksums;
vendor macros, firmware retraction semantics, actual nozzle/material mapping,
and native OrcaSlicer preview parity are still unsupported. A local parser
regression explicitly proves no phantom path is drawn for malformed commands.
The WASM engine and published slicing capabilities are unchanged.

## 2026-11-14: compact motion words in strict native/WASM G-code comparison

The read-only native-vs-WASM comparator `scripts/compare_gcode.py` now
recognizes **fully valid compact G0/G1/G2/G3 words**, including
`G1X10Y20E1`, `N15G01X10E1`, signed exponent coordinates and mixed
spaced/compact numeric parameters. It normalizes their numeric values and
counts extrusion-state fixture moves with the same strict ordered comparison
as spaced motion lines. Previously, compact lines could be mistaken for
non-motion and cause false fixture diagnostics or omit numeric mismatch
details. A malformed or checksummed compact line is retained verbatim rather
than partially converted, and unrelated vendor M-code text is left untouched.
New unit tests cover equivalent formatting, numbered lines, parameter deltas,
malformed words and vendor-command conservatism.

This **does not execute G-code**, validate machine-specific syntax, establish
any native OrcaSlicer v2.5.0 vs WASM output parity, or relax differences
in the motion-command order. The true paired full-profile comparison is
still outstanding; test and CI status must be checked independently.


## 2026-11-14: bounded absolute process speed profile bridge (candidate CI)

The opt-in localhost-only Orca profile adapter now recognizes three native
process keys, `outer_wall_speed`, `inner_wall_speed`, and `travel_speed`,
as **absolute numeric millimetres/second** values. The restricted flat
process override parser accepts the same keys. The diagnostic input bounds
are 1–800 mm/s for wall speeds and 1–1500 mm/s for travel speed; these are
parser bounds, **not** a claim that any attached printer supports those speeds.
Inheritance is resolved before forwarding. Percent-relative speed strings,
multi-nozzle arrays, nonnumeric values and values outside the bounds are
rejected rather than guessed. Existing unsupported fields remain excluded.

A new isolated-Chrome regression compares actual candidate-WASM G-code
generated with the same STL/transform, layer height and shell count before
and after changing only these three process speed overrides. It requires
the engine to finish and the G-code SHA-256 to change. Hash difference alone
does not establish exact feedrate semantics, full-profile fidelity or native
desktop G-code parity. The corresponding pinned upstream Creality fixture
will continue running in its separate read-only CI job. **CI results for this
new change must be observed separately, not assumed PASS.**

No engine binary, production public-site slicing or printer-ready profile
is enabled by this change. Next work remains true native in-place 3MF
editing and full native-vs-WASM paired same-input comparison.


## 2026-11-14: observed native-WASM process speed test PASS

[Pin-verified upstream profile CI #43574539971](https://github.com/temesotejam/layer-workbench/actions/runs/43574539971)
**PASS** on commit `31e94fc`. The real upstream v2.5.0 Creality CR-10
0.20 mm chain resolved `outer_wall_speed=25`, `inner_wall_speed=30`
and `travel_speed=120` mm/s; 228 process keys in that selected chain
remain unsupported, and neither a full printer configuration nor real
printability has been verified.

[Isolated Chrome CI #43574539928](https://github.com/temesotejam/layer-workbench/actions/runs/43574539928)
**PASS**: two STL objects on one native plate, the same layer height and shell
count, then bounded numeric wall/travel speeds were changed through the
restricted `orca.native-json` profile operation. The browser's genuine WASM
G-code bytes changed and the read-only path preview remained functional.
This is an integration smoke and hash-difference check; it does not prove
specific native feedrates, official full-profile parity or safe real printing.
[Pages #43574539931](https://github.com/temesotejam/layer-workbench/actions/runs/43574539931)
**PASS**; the unverified WASM engine was not enabled on Pages.


## 2026-11-14: independent native first-layer height bridge (CI pending)

The localhost-only restricted process adapter now accepts OrcaSlicer's
`initial_layer_print_height` independently of `layer_height`, within a
conservative 0.06–0.50 mm diagnostic range. Flat test overrides and inherited
raw process profiles both forward only a finite absolute millimetre value;
percentage strings, arrays and out-of-range values fail closed. No
machine-specific first-layer calibration or real printer safety is implied.

The isolated Chrome acceptance test has a stronger observable gate than a
G-code hash: with the same two-STL fixture and unchanged wall, speed and
regular layer settings, it alters only the first-layer height to 0.26 mm
and checks the first **deposited** G-code layer's Z position. This assumes
an unrafted flat synthetic cube with no printer-specific Z offset; it is
not a general firmware simulator or full-profile parity test. **The new
GitHub Actions result must be inspected separately; do not presume PASS.**
No engine source/pthread build material was modified, and no new WASM engine
was authorized for the public Pages deployment.

## 2026-11-14: modal commanded G-code feedrate in local Preview (CI pending)

The read-only G-code toolpath parser now retains each G0/G1/G2/G3 segment's
**modal commanded F** in mm/min (including G20/G21 unit conversion and
carry-forward for moves without a fresh F). It rejects nonpositive and
implausibly large F words before mutating XYZE/modal state. Missing F is
represented as `null`, never inferred. The isolated 2D layer diagnostic
shows the minimum and maximum commanded F of the layer's deposition segments
in mm/s, or explicitly reports that F is unavailable. The actual candidate
WASM Chrome acceptance probe now requires positive modal F on its deposited
G-code segments, rather than relying on a source-only parser unit test.

This is **not** actual head speed or elapsed time: firmware acceleration,
jerk, cooling, flow limits and printer execution are not simulated. No speed
color mapping, verified machine profile, physical printer output or published
WASM slicing is enabled. CI status must be inspected after this commit.

## 2026-11-14: bounded Preview feedrange and stronger speed-effect gate (CI pending)

The 2D layer's commanded-F minimum/maximum calculation now uses a constant-
stack loop rather than spreading an untrusted segment array into Math.min/max,
which can throw for a valid 200,000-segment diagnostic. The isolated Chrome
acceptance test also compares distinct **deposited G-code F words** between
unchanged profile geometry and wall/travel-only speed overrides. This closes
the prior gap where a changed G-code SHA could reflect metadata alone. These
are G-code command values, **not** measured physical toolhead speeds or Orca
desktop native-vs-WASM parity. CI outcome must be confirmed independently.

## 2026-11-14: investigation of process speed smoke false positive (CI pending)

[Chrome #43584553138](https://github.com/temesotejam/layer-workbench/actions/runs/43584553138)
**FAIL**: when the diagnostic only raised outer/inner wall and travel speed
limits (35/65/110 mm/s), the actual native WASM deposited extrusion F words
were unchanged despite different output G-code hashes. Therefore the prior
hash-only acceptance was too weak; we retract any claim that that specific
speed-change fixture proved a real feedrate change. This can happen when
other path/cooling/flow speed caps dominate, or when the native adapter does
not apply the intended fields. The next safe fixture explicitly lowers the
requested outer/inner wall speeds to 5/8 mm/s and travel speed to 20 mm/s,
then compares physical G-code F words. If it also fails, native config
application must be diagnosed rather than masking the failure.


## 2026-11-14: surgical single-build Core 3MF transform edit (CI PASS)

[3MF audit CI #43587392241](https://github.com/temesotejam/layer-workbench/actions/runs/43587392241) **PASS** on commit `cdfc073`: 4 new focused cases and all previously existing 3MF archive/scene/geometry tests pass. Earlier attempts failed on a test syntax typo and an assertion message mismatch, both fixed; neither failure demonstrated a production or WASM defect.

A new **offline diagnostic** `scripts/edit_3mf_build_transform.py` edits one
explicit `3D/3dmodel.model` Core `<build><item transform="...">` attribute
in an *independently generated* two-placement 3MF. It selects by zero-based
build-item index and uses the **3MF 12-number row-vector convention** (not a
Three.js or one-slicer-api native 4×4 matrix). It checks the existing scene
with the bounded 3MF audit, refuses malformed/singular transforms, ambiguous
attribute syntax, invalid ZIP paths, multi-model parts, missing transforms,
overwrites and in-place source writes. After writing a separate archive, it
verifies exactly one decompressed ZIP member changed, other build placements
and mesh counts survived, and all other ZIP member payloads (including opaque
metadata files) match byte-for-byte after decompression. A new synthetic
unit suite checks these cases through the lightweight 3MF CI workflow.

**Limits:** This is neither a new WASM API nor an OrcaSlicer desktop-created
3MF edit. Other ZIP members' bytes are preserved, but their semantic
consistency with the changed model transform is *not guaranteed*. Even
`3D/3dmodel.model` is only changed by a narrow, explicitly present attribute
replacement, not a full native project metadata update. Archive compression
bytes may change. It is intentionally not wired into the public browser UI,
does not certify desktop reopening/G-code or real printing. Next gate is
an imported-3MF **native in-place** session edit with metadata-aware semantics
and independent browser/desktop validation.

### 2026-11-14: edited Core archive imported by accepted native WASM

[Isolated Chrome #43587544199](https://github.com/temesotejam/layer-workbench/actions/runs/43587544199) **PASS** with the previously accepted (not rebuilt) v2.5.0 WASM candidate. A separately generated Core 3MF was surgically edited at build index 1, shifting that 20 mm synthetic cube from X=150–170 to X=180–200 mm while retaining the first placement X=90–110 mm. The isolated browser imported the edited archive through the native 3MF project API, verified two native objects/instances, 24 flattened triangles with the changed XYZ bounds, and byte-identical `preservation=require` export of the **already edited, then untouched** archive. It does **not** demonstrate in-session native editing, editing a real desktop 3MF, semantics of opaque metadata after a change, or native-vs-WASM G-code parity. No new engine binary or public slicer behavior was enabled.

## 2026-11-14: unit-aware relative Core build placement move (CI pending)

The offline Core 3MF editor now accepts `--translate-mm DX DY DZ` as an
alternative to replacing the full 12-value transform. The selected item's
world-axis movement is converted from mm to the model's declared `unit`,
and only translation slots 9–11 change; existing rotation, scale and sibling
placements are retained. The synthetic regression covers a previously
rotated/nonuniformly scaled item, an `inch` model, opaque-member retention,
and invalid/no-op input rejection. The accepted-candidate isolated Chrome
test now uses the relative +30 mm X operation to exercise actual WASM import
of the edited 3MF. This is NOT native in-session 3MF editing, desktop 3MF
parity, G-code parity, or print validation. CI results must be checked.
[3MF archive unit/audit CI #43590683393](https://github.com/temesotejam/layer-workbench/actions/runs/43590683393)
**PASS** for the new relative move and existing archive/scene suites.
[Accepted-candidate isolated Chrome #43590683455](https://github.com/temesotejam/layer-workbench/actions/runs/43590683455)
**PASS** with a +30 mm relative X move on the second Core build item:
two native objects/instances, 24 triangles, exact modified absolute placement,
and untouched-export byte identity of the *already edited* archive.
[Pages #43590683405](https://github.com/temesotejam/layer-workbench/actions/runs/43590683405)
**PASS**; no WASM binary or unverified slicing was deployed.


## 2026-11-14: selected Core 3MF build Z rotation (CI PASS)

The offline diagnostic editor now additionally accepts `--rotate-z-deg 90`
to post-compose a selected build item's 3MF row-vector linear transform with
a world-Z rotation. The pivot is the item's **existing translation anchor**,
not its mesh center or bed center. The translation, other build placements,
triangle mesh payloads and unrelated decompressed ZIP members remain intact.
The bounded input refuses nonfinite, no-op and >360-degree requests. Unit tests
exercise a 90-degree rotation, pre-existing nonuniform scale, unrelated ZIP
metadata and invalid inputs. The accepted-candidate Chrome gate checks a
rotated independent Core cube's exact bounds and untouched archive export.

**Not established:** true in-session native project transform editing, the
correct pivot of desktop OrcaSlicer gizmos, metadata semantic consistency
after an edit, a desktop-created project round-trip or printable G-code.
No public WASM or new candidate engine binary is enabled.

[3MF archive CI #43596516386](https://github.com/temesotejam/layer-workbench/actions/runs/43596516386)
**PASS** for Python regression plus existing scene and preservation suites.
[Accepted WASM Chrome #43596516338](https://github.com/temesotejam/layer-workbench/actions/runs/43596516338)
**PASS**: independently generated Core 3MF with the second 20 mm cube
rotated +90 degrees around its build translation imported into the native
v2.5.0 WASM engine. The first cube remained unchanged, the rotated cube's
X bounds changed from 150–170 mm to 130–150 mm while Y/Z bounds stayed
fixed, two instances and 24 triangles were retained, and the *already edited*
Core archive exported byte-identically with `preservation=require`.
[Pages #43596516391](https://github.com/temesotejam/layer-workbench/actions/runs/43596516391)
**PASS** with diagnostic code only; no candidate WASM deployment.


## 2026-11-14: local-axis nonuniform scale of a Core 3MF build item

The offline diagnostic editor `scripts/edit_3mf_build_transform.py` now accepts
`--scale-local SX SY SZ` with bounded strictly positive, dimensionless
factors. It pre-multiplies the selected build-item matrix by a row-vector
scale (local axes), preserving the existing build translation as the pivot.
It does not interpret the pivot as the mesh center, decompose rotation/shear,
or change other build items. Negative/mirror, zero, no-op and out-of-range
factors fail closed; unrelated ZIP members are compared after decompression.
Synthetic tests cover existing nonuniform rotation, an opaque metadata member,
model unit independence, and invalid inputs.

The pinned isolated-Chrome acceptance adds a nonuniform scale of a synthetic
two-build Core 3MF and checks its resulting XYZ bounds and untouched native
WASM re-export. This does **not** establish native-session edits or
desktop-authored Orca 3MF metadata compatibility. CI confirmed **PASS** in [archive preservation and 3MF edit unit tests #43603906325](https://github.com/temesotejam/layer-workbench/actions/runs/43603906325) (13 edit tests including 3 new scaling tests), and [isolated Chrome/WASM 3MF placement test #43603906304](https://github.com/temesotejam/layer-workbench/actions/runs/43603906304). The Chrome job logs explicitly show the nonuniform XYZ bounds and untouched export gate passing. No candidate rebuild or
public engine deployment is required.


## 2026-11-15: support modifier CI recovered; private 3MF C ABI called in isolated Chrome (PASS)

Candidate [#43639277062](https://github.com/temesotejam/layer-workbench/actions/runs/43639277062) **PASS** on PR #5 after correcting only the pinned synthetic support smoke fixture. The real WASM job logs show API conformance, asynchronous binding, native multi-object 3MF, private imported-instance edit, and **both** role-specific support-enforcer and support-blocker G-code-difference assertions passing. This is a smoke fixture adjustment, **not** evidence that real printer support generation or desktop G-code parity is identical. [PR #5](https://github.com/temesotejam/layer-workbench/pull/5) merged at `9c6b58540f62bb0ae49e4892f65efb7d4683c19c`. No heavyweight duplicate build was launched.

[Isolated Chrome CI #43647874026](https://github.com/temesotejam/layer-workbench/actions/runs/43647874026) **PASS** using the **exact successful candidate #43639277062** and a localhost COOP/COEP server. New `scripts/test-browser-3mf-private-instance-edit.mjs` invokes `_orcawasm_project_edit_instance_transform` directly through the pinned test-only `session.binding.module` bridge, instead of relying on the earlier Node-only private C smoke. For an independently generated two-object Core 3MF the browser test proves: unchanged-source byte-identical export, rejected invalid edits leave the entire manifest unchanged, +30 mm X transform on the second instance only, unchanged first instance and object hierarchy, strict preservation refusal after editing, and best-effort 3MF re-import with the modified placement. [PR #6](https://github.com/temesotejam/layer-workbench/pull/6) merged at `cbdcb2ce62d58f6e464833ddb9e87d9acf20e87e`. The accepted-candidate Chrome workflow is pinned to successful run #43639277062 rather than rebuilding the engine, and the experimental C symbol is **never added to the public UI**.

**Remaining critical limitations:** the private API updates only the in-memory session's project manifest, not the underlying `Slic3r::Model` or full Orca project hierarchy; best-effort export is not lossless and may discard opaque metadata. This synthetic 3MF was not authored by desktop OrcaSlicer. Full-profile native-vs-WASM G-code equality, printer-specific settings, production COOP/COEP deployment, and full desktop UI parity remain unverified. Do not claim safe-to-print output or deploy this unverified engine to public Pages.

## 2026-11-15: experimental private 3MF instance edit changes re-sliced XY deposition

[Isolated Chrome accepted-candidate CI #43654454882](https://github.com/temesotejam/layer-workbench/actions/runs/43654454882) **PASS** for the pinned OrcaSlicer v2.5.0 WASM artifact #43639277062. A private test-only C API translates one instance of an independently created two-cube Core 3MF by +30 mm X; the unchanged instance remains at X=90..110 mm, the second moves from X=150..170 mm to X=180..200 mm. After validating the edited manifest, 3MF export and native WASM-flattened STL bounds, the new `scripts/diagnose-edited-3mf-toolpaths.mjs` independently flattens the **before and after** archives via the actual WASM `threeMfToStl()`, starts fresh sessions using the **same fixed generic PLA test configuration**, and slices the two flattened STL documents. The G-code preview parser then requires deposited XY segments in the original second-cube region **only before** the edit, in its shifted region **only after**, and in the untouched first-cube region in both cases; travel-only lines and first-layer priming are excluded. A local synthetic G-code unit test proves the rejection behavior as well. This goes beyond validating manifest numbers or flattened STL coordinates: the test confirms a corresponding change in a newly generated WASM G-code toolpath.

**Critical boundary:** this is best-effort edited-3MF export → native WASM STL flattening → new generic-profile STL slicing. It does **not** slice the modified `Slic3r::Model` in place, prove native imported-project 3MF slicing, preserve all opaque Orca metadata, reproduce official full printer/filament/process profiles, compare native desktop and WASM G-code, or certify printable output. The generated G-code stays inside the ephemeral CI test, and the production Pages engine remains disabled. Next: validate editing and re-slicing directly through the native `Slic3r::Model` state and then compare same-STL/full-profile native desktop and WASM G-code.

## 2026-11-15: imported 3MF edited and re-sliced within one WASM session (isolated Chrome)

[Merged PR #14](https://github.com/temesotejam/layer-workbench/pull/14) adds
`scripts/diagnose-in-session-3mf-reslice.mjs` and a fail-closed test to
investigate whether the imported 3MF project can be sliced **without** the
previous best-effort 3MF export → `threeMfToStl()` → new STL session path.
[Chrome CI #43678749964](https://github.com/temesotejam/layer-workbench/actions/runs/43678749964)
**PASS** for the first candidate run: an *independently generated two-cube Core 3MF*
was imported through `initProfile('project.3mf')`; a bounded synthetic PLA
profile (including explicit absolute E mode) was applied; `session.slice()`
returned test-only G-code; the existing private C ABI moved only the second
instance by +30 mm X; and `session.slice()` succeeded **again on the same
imported session**. The pre-existing multi-layer toolpath checker required
both 20 mm cubes' deposited XY paths to occupy their correct old/new regions
at 3+ interior Z levels spanning 6+ mm. No host-side STL flattening,
`setObjects()`, best-effort 3MF export, or replacement session was used
in this new diagnostic. Node mocks also require rejected/stale G-code to fail.

**Important engine boundary, verified against pinned Hiosdra/OrcaWasm source:**
`oneslicer_init_profile` loads a native Orca `Slic3r::Model` then
`append_native_model_project` serializes its raw geometry into a normalized
STL mesh blob/manifest. The `oneslicer_project_slice` path calls
`build_project_plate_model` to construct a **new temporary** native
`Slic3r::Model` for each slice. The private instance edit mutates the
manifest, **not** a persistent native `Model`. The observation is therefore
an in-session native slicing integration milestone, **not** true persistent
`Slic3r::Model` editing, 3MF metadata preservation, native desktop G-code
parity, real printer-profile support, or printable output. The Chrome test
still loads an existing vetted candidate on localhost COOP/COEP and does
not deploy WASM to Pages.

## 2026-11-15: same-session imported Core 3MF edit → undo → third native WASM slice

[Merged PR #15](https://github.com/temesotejam/layer-workbench/pull/15)
adds a third real isolated-Chrome slice to the existing synthetic two-cube
Core 3MF test. After the initial session.slice() and a +30 mm private
manifest instance translation, the test confirms the second slice deposits
on the shifted cube. It then restores the **original instance matrix using
the same private C ABI and the same imported WASM session**, requires the
full imported manifest to match its original snapshot, and checks the third
slice deposits on the original cube rather than reusing the shifted paths.
The independent G-code parser requires 3+ interior Z layers spanning 6+ mm;
the restored and initial per-region deposition counts, occupied layers and
Z spans must agree. A negative Node regression simulates an API that falsely
reports successful undo but leaves the changed manifest, which is rejected.

[PR Chrome/Node CI #43682447900](https://github.com/temesotejam/layer-workbench/actions/runs/43682447900)
**PASS** using the already accepted WASM candidate artifact
#43639277062. No engine rebuild or new published WASM artifact was required.
This verifies reversible **manifest-driven** three-phase synthetic toolpaths,
not a native persistent Slic3r::Model mutation, lossless desktop 3MF
metadata preservation, native-vs-WASM G-code parity, or printable output.
The next structural milestone is to retain native object/volume semantics
across imported project edits rather than regenerating a temporary model
from flattened mesh data on every slice.

## 2026-11-16: conservative G17 arc geometry fixture gate (CI PASS)

The optional `--min-extrusion-moves` acceptance gate previously counted
`G2 X1 E1` as deposited arc motion even though it specifies no center/radius,
and counted zero-radius or geometrically impossible arc commands. This could
let a synthetic pair satisfy the minimum-deposition **fixture** requirement
without corresponding valid circular paths. The gate now recognizes only
geometrically plausible `G17` arcs with a nonzero I/J center or a feasible
R chord; it rejects ambiguous combined R+I/J, unsupported G18/G19,
zero-radius/full-circle R, and mismatched endpoint radii. It tracks
G90.1/G91.1 center interpretation and G20/G21 unit changes. Positive-E
linear G1 counting and strict ordered G-code comparison remain unchanged.

Focused unit cases cover invalid, full-circle, valid radius, non-XY-plane,
absolute-center and inch-unit input. Initial [PR CI #43736737376](https://github.com/temesotejam/layer-workbench/actions/runs/43736737376)
failed because the restored-G17 synthetic fixture had inconsistent radii; the
fixture was corrected, and [PR CI #43736798426](https://github.com/temesotejam/layer-workbench/actions/runs/43736798426)
**PASS** (comparator and dependent parity tests). This is a **conservative sanity filter**
that can undercount supported-but-unmodeled firmware arcs, not a full G-code
interpreter, a slicer parity result, proof of deposited volume or printable
output. In particular, an identical pair of synthetic commands is not
proof of native OrcaSlicer v2.5.0 versus WASM equivalence.

## 2026-11-16: fail-closed G-code fixture syntax sanity gate

The **optional** `--min-extrusion-moves` checker no longer treats a motion
line as a valid deposition fixture if its numeric words are ambiguous:
duplicate axes/extrusion parameters, opaque or malformed tokens, embedded
G/M/N/T opcode words, or unsupported checksums cause a conservative **zero
deposition count**. Malformed G92 resets also invalidate counting, including
subsequent moves whose coordinate baseline would be unknown. A normal valid
feed-rate word or a geometrically valid G17 arc remains countable. These rules
are deliberately conservative; some firmware extensions may be undercounted,
and the main ordered command comparison is unchanged.

This prevents a **synthetic self-identical bad file** from satisfying the
minimum-deposition acceptance gate. It does **not** validate a physical
printer's G-code dialect, prove native/WASM source provenance or provide
desktop v2.5.0 toolpath parity. Lightweight CI for this change:
[PR #27 comparator](https://github.com/temesotejam/layer-workbench/pull/27).


## 2026-11-17: positive E commanded-length metric for parity diagnostics

The strict native-versus-WASM G-code comparator now reports each input's
`native_counted_positive_e_mm` / `wasm_counted_positive_e_mm` and the signed
`counted_positive_e_delta_mm` (WASM minus native). These numbers add **positive
filament-axis E deltas only on the same XY extrusion moves counted by the
existing conservative fixture gate**; G92 resets, absolute/relative E,
G20/G21 unit conversions, E-only priming, negative retractions, travel moves
and supported G17 I/J or R arcs follow the existing modal checks. If ambiguous
motion syntax invalidates that gate, the E totals are `null` instead of
misleadingly zero. Positive E length is not volume, mass, flow calibration,
physical deposited filament, or printer-safety evidence.

The added metrics are diagnostic only: strict ordered command matching,
input-hash provenance checks, and the existing minimum-deposition gate still
determine `match`. In particular, this does **not** establish an identical
full-profile native-vs-WASM comparison. The fixture pair must first carry
identical, separately sourced model and effective profile data.

## 2026-11-17: counted G1 deposited XY length diagnostic

The strict comparator now reports `native_counted_linear_xy_moves`,
`wasm_counted_linear_xy_moves`, `native_counted_linear_xy_mm`,
`wasm_counted_linear_xy_mm` and signed `counted_linear_xy_delta_mm`
(WASM minus native, rounded to 0.000001 mm). It sums Euclidean
**straight-line XY path length only for positive-E G1 moves already accepted
by the conservative deposition gate**. It follows G90/G91, G92 XY resets,
G20/G21 units, M82/M83 and E resets, and rejects stationary XY priming.
Supported G17 G2/G3 arcs still contribute to the pre-existing E/count
diagnostics, **but their curved lengths do not enter this new linear-only
metric**. Unknown/ambiguous move syntax produces `null` linear totals,
not a misleading zero.

Synthetic regression checks include a 3–4–5 diagonal, a radius-defined
full-circle arc exclusion, stationary priming, inch-to-mm transitions,
G92 ambiguity, and a changed XY path with unchanged commanded E. This is
only a geometry-sensitive **diagnostic**; neither matching totals nor
matching strict commands authenticate executable provenance or prove
native-vs-WASM full-profile slicing parity. No WASM binary, official
profile file or public Pages engine switch is changed. No G-code is
certified for printing.


## 2026-11-21: G28 homing discontinuity in diagnostic G-code Preview

The read-only `scripts/gcode-preview-parser.mjs` previously ignored `G28`,
which could draw a fictitious extrusion/travel segment from a pre-home XYZ
position to the first commanded post-home position. The parser now marks
homed axes as **unknown** (all XYZ for a bare `G28` or unrecognised vendor
flags). The first subsequent absolute motion that re-establishes the
affected axes is **not** drawn: its start remains unknown. A fully explicit
`G92` for the affected axes can re-anchor without such an omitted move.
Relative moves alone cannot restore a known origin. The diagnostic exposes
`skippedUnlocatedMotions` and counts a skipped unlocated arc with
`skippedArcs`; regressions cover full/partial home, G92, vendor flags,
and arcs. This does **not** implement firmware-specific home offsets, actual
homing motion, printer state, or physical G-code compatibility. Existing
production/public engine integration remains unchanged.


## 2026-11-21: G53 machine-space and G54–G59.3 workspace Preview discontinuities

The bounded, read-only `scripts/gcode-preview-parser.mjs` cannot know the
firmware's native-to-work-coordinate offset. It now treats standalone and
same-line machine-workspace `G53` commands, and work-coordinate selection
`G54`–`G59.3`, as unknown XYZ discontinuities rather than rendering a
phantom straight segment connecting positions from incompatible coordinate
systems. The first subsequent full absolute XYZ move re-establishes an
endpoint but is not drawn; an explicit `G92` can re-anchor selected axes.
The additional `skippedWorkspaceCommands` counter distinguishes these
omitted commands from invalid syntax or absent arc support.

For `G53 G0/G1` with an opaque or explicit E change, the E origin is also
considered unknown until an explicit `G92 E` or absolute E re-anchor. The
re-anchor stroke is omitted instead of fabricating a travel/deposition label.
These guards are conservative across firmware variants: a workspace switch
may be a no-op on a particular printer, and the diagnostic may hide valid
paths. The implementation does not reconstruct offsets, execute G53 motion,
interpret CNC machine state, certify generated G-code, or enable public
Pages WASM features. Regression coverage uses synthetic source lines only.

## 2026-11-21: explicit tool-change E discontinuity in diagnostic G-code Preview

The isolated read-only G-code Preview no longer assumes that absolute E
coordinates are comparable across a **change between distinct valid T0–T254
selectors**. Marlin's [multi-extruder documentation](https://marlinfw.org/docs/features/multi_extruder.html)
states that tool changes can reset the extruder position, and recommends
`G92 E0` after switching tools when using `M82`; other firmware and
multi-material configurations can differ. The parser therefore marks the
absolute E origin unknown on a distinct explicit tool switch, omits the
first post-switch absolute-E stroke, and resumes after an explicit `G92 E`
or that first absolute E re-anchor. Repeated selection of the same tool
does not invalidate it; the reserved T255 unload label and out-of-range
vendor T commands are not treated as ordinary physical tool selections.
Relative-E (`M83`) moves can still use their own signed E word to classify
extrusion, while a later return to `M82` again requires an absolute anchor.

Regression fixtures cover low-to-high and high-to-low E register changes,
explicit `G92 E` recovery, unchanged tool reselection, T255/T1000, and a
relative-to-absolute E mode transition. This is a conservative **preview
classification safeguard**, not full Marlin/OrcaSlicer G-code interpretation:
implicit tool selection, tool-change macros, firmware-specific offsets,
XYZ/toolhead repositioning, and real-world deposition remain unverified.
These local changes do not enable production WASM or certify print-safe G-code.


## 2026-11-23: bounded requested-heater setpoint diagnostics

The native/WASM G-code comparator now includes an independent **read-only
diagnostic** for explicit `M104/M109` nozzle and `M140/M190` bed setpoints.
It preserves command type, S/R mode and explicit T tool selection, compares
their **ordered** request lists, counts all differences and provides at most
15 bounded examples. A Celsius delta is reported only when command, heater,
mode and tool agree. An implicit tool is deliberately `null`, not inferred.

Unknown/opaque heater requests (macros, extra or conflicting words, malformed
temperatures or tool indexes) make the diagnostic unavailable (`null`),
not a fabricated zero difference. It does **not** change strict ordered
G-code matching, compare actual heater readings, establish profile parity,
interpret other firmware heater commands or certify printing safety.
Synthetic comparator regression tests alone are not the still-missing
official v2.5.0 native-versus-WASM **same STL/full profile** G-code comparison.

## 2026-11-23: Marlin chamber heater requests in G-code diagnostics

The bounded, read-only native/WASM heater comparison now recognizes explicit Marlin-style `M141 S...` (set chamber target without waiting) and `M191 S...`/`M191 R...` (set target and wait), in addition to nozzle (`M104`/`M109`) and bed (`M140`/`M190`) commands. Chamber requests are reported with `heater: chamber`; command type and S/R waiting mode are preserved rather than treating a set and a wait as interchangeable. `M104`, `M140` and `M141` with an `R` word are now **unknown** instead of inferred as supported requests. Extra heater selectors (`P`, `H`, chamber `T`), compact forms, macros and firmware-specific semantics remain unsupported and cause unknown diagnostics, not a fabricated temperature delta of zero. Sources: [Marlin M141](https://marlinfw.org/docs/gcode/M141.html) and [Marlin M191](https://marlinfw.org/docs/gcode/M191.html). This compares commanded targets only, not actual temperatures, correctness of printed G-code or native/WASM equivalence. Comparator equality remains strict and independent of this optional diagnostic.


## 2026-11-26: explicit fan request comparison (diagnostic only)

The source-pinned [GCodeWriter.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/GCodeWriter.cpp)
emits M106 S PWM requests, indexed P2/P3 requests and other flavor-specific
forms. The strict native/WASM comparator now separately compares ordered
explicit M106 S (optional P) and M107 (optional P) events. It retains absent
selectors rather than assuming P0 and reports at most fifteen difference
examples, with a signed PWM-word delta only for aligned M106 commands with
the same selector. Ambiguous syntax, P-only M106, M126/M127, unknown
parameters and out-of-range values produce an unavailable diagnostic.
This is not an effective firmware fan-state simulation, physical duty-cycle
measurement, profile equivalence proof or printable-output validation.
Strict G-code equality is unchanged; no engine or public WASM change.


## 2026-11-26: exact numeric-word canonicalization for strict comparison

Python Decimal.normalize() uses the active decimal context (normally 28
significant digits). Consequently different numeric words could previously
be rounded to the same canonical command. The comparator now removes trailing
coefficient zeros using the exact Decimal tuple, preserving sign and value
without context rounding. Unrepresentable words stay opaque. Regressions
exercise distinct long-precision K words and mathematically equal exponent
spellings. Ordinary opcode spelling and command order remain unchanged.
This fixes the ordered command equality gate only: geometric and optional
heater/fan metrics still have their own numerical limits. It does not reduce
engine differences, prove full-profile equivalence, or enable public WASM.
