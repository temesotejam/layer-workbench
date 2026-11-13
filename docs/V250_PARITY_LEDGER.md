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
