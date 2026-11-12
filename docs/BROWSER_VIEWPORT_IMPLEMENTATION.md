# Browser Prepare viewport implementation

Updated: 2026-11-12.

## Implemented in this milestone

- Replaced the decorative CSS-only plate with a real Three.js WebGL canvas.
- Added pinned Three.js 0.180.0 ES-module imports via an import map.
- Added orbit/pan/zoom camera controls.
- Added a 256 × 256 mm XY build plate, grid, border and XYZ axis helper.
- Added local file parsing and geometry rendering for STL, OBJ and basic 3MF via Three.js loaders.
- Added a local object list, selection highlighting, camera fit on first model, and drag/drop into the viewport.
- Kept slice/profile/save/preview/device operations disabled because they are not yet connected to the OrcaSlicer WASM engine.

References:
- Three.js module/import-map guidance: https://threejs.org/manual/en/fundamentals.html
- OrbitControls: https://threejs.org/docs/pages/OrbitControls
- Three.js addons include STLLoader, OBJLoader and ThreeMFLoader: https://threejs.org/docs/

## Important limitations

This viewport is an initial web renderer, not OrcaSlicer's native GLCanvas3D. It does not yet reproduce native camera presets, bed geometry from printer profiles, object hierarchy/volumes/instances, gizmos, selection semantics, snapping, clipping, support/paint overlays, texture displacement, or G-code preview.

ThreeMFLoader support is not a guarantee of full Orca/Bambu 3MF compatibility. Three.js has known unsupported 3MF extensions (including some production extensions); the native OrcaSlicer C++ 3MF import path remains the authoritative route for full project semantics. Do not use this viewer to rewrite or round-trip native projects.

The renderer currently centers each imported model and places its lowest bound on the plate for visualization only. This is not a native transform edit and does not alter the original file.

## Next integration gates

1. Browser-run test with real fixture files (STL, OBJ, standard 3MF, and Orca-specific 3MF); report unsupported extensions explicitly.
2. Replace ThreeMFLoader project interpretation with the OrcaSlicer WASM native 3MF import/manifest path.
3. Render engine-returned geometry and preserve object/volume/instance hierarchy.
4. Add native transform operations and actual gizmo interaction.
5. Add printer-profile-derived bed geometry and size.
6. Connect profiles and slicing only after SharedArrayBuffer/pthread hosting and the WASM loader are verified on the deployed Pages origin.

## 2026-11-12: real Chrome browser verification

Added a reproducible headless-Chrome workflow: [browser-e2e.yml](../.github/workflows/browser-e2e.yml), running [test-browser-ui.mjs](../scripts/test-browser-ui.mjs).

The initial Chrome run exposed an incidental missing favicon request (HTTP 404). A harmless data-URL favicon was added to the page, while the browser test was enhanced to report error response URLs.

[Browser E2E #43218225115](https://github.com/temesotejam/layer-workbench/actions/runs/43218225115) **PASSED** in Google Chrome 156. Verified WebGL canvas creation, binary STL cube import and rendering, object selection, Move/Rotate/Scale mode switching, Fit and Delete. A screenshot of the loaded model is retained as a CI artifact. [Static UI validation #43218227878](https://github.com/temesotejam/layer-workbench/actions/runs/43218227878) and [Pages deployment #43218225418](https://github.com/temesotejam/layer-workbench/actions/runs/43218225418) also passed.

**Limits:** this does not prove that dragging a transform gizmo produces identical native transform values, nor does it validate ThreeMFLoader against native OrcaSlicer projects, printer profiles, G-code preview or the WASM browser bridge. The successful engine artifact remains separate from the public browser UI.
