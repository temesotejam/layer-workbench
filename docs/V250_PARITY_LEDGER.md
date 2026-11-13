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
