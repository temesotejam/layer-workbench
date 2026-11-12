# OrcaSlicer v2.5.0 desktop ↔ WebAssembly parity ledger

Updated: 2026-11-12 (JST). This is an **evidence ledger, not a declaration of parity**.

## Proven on CI candidate

Source: official OrcaSlicer `v2.5.0` checkout plus pinned Hiosdra/OrcaWasm `60a09e04f1990be39c8f6f35dffef1a2c9e224c4`, with the tracked v2.5.0 adapter. GitHub Actions [candidate 43139730644](https://github.com/temesotejam/layer-workbench/actions/runs/43139730644) compiled and linked `slicer-mt.js` and `slicer-mt.wasm`, with successful one-slicer-api 0.7.0 conformance, async binding, and Node smoke tests. Artifact: [13909408785](https://github.com/temesotejam/layer-workbench/actions/runs/43139730644/artifacts/13909408785).

Verified tests include synthetic mesh and selected/all-plate slicing, G-code output, 3MF basic load/export, transforms and placement, arrangement, profile operations, support enforcer/blocker modifier behavior, async slicing/progress, cancellation, and a subsequent slice. These tests show **working headless core paths**, not desktop equivalence.

The original candidate reported `engine.version=2.4.2` from a hardcoded string in the pinned bridge. The adapter now changes the capability string to `2.5.0`, and CI verifies the source metadata before building. This is a **metadata fix only**, not proof that all APIs or features were ported. The corrected candidate build must finish before its runtime version is confirmed.

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
| Version shown by capability JSON | Old bridge string was hardcoded; corrected via CI adapter | Await fresh runtime verification |

## Required acceptance tests before any “same as desktop” claim

1. Build unmodified desktop CLI from exact official `v2.5.0` commit, record the git SHA and compiler/dependency versions.
2. Feed identical STL, OBJ and 3MF projects with identical printer/filament/process profiles into desktop CLI and WASM; compare geometry, plate placements, slice statistics, and parsed G-code motion/extrusion/toolpaths. Normalize only nondeterministic timestamps and paths. Record numeric differences, not just exit codes.
3. Cover seams, bridges, overhangs, support-enforcer/blocker, adaptive layers, multi-material, multi-plate, intricate thin walls and stress/cancellation cases, plus v2.5.0 new features explicitly.
4. Round-trip real projects with opaque metadata, paint masks, texture assets and printer settings; inspect missing entries/attributes against native output.
5. Test editor functionality and rendering in an isolated browser, including pthread/SharedArrayBuffer, worker cancellation and large files; verify web-page integration separately.
6. Implement or explicitly mark missing desktop-only features unsupported. Do not claim functional equivalence while any key feature is missing.

## Release policy

A successful WebAssembly candidate with green CI is **a valid headless slicing engine candidate**. It is **not a feature-complete OrcaSlicer desktop replica**, and does not authorize publishing an unverified WASM build to the public site. Preserve upstream source, third-party notices and existing working deployment.
