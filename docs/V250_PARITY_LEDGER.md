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
