# Browser engine API expansion plan

Status: design specification; not yet implemented.

This document defines the next API boundary for exposing more of the upstream C++ model-editing and mesh-processing logic to the browser. It is deliberately separate from the current one-slicer-api 0.7.0 contract, which is focused on sessions, profiles, projects, slicing and export.

## Design principles

1. The upstream C++ implementation remains authoritative for geometry, transforms, mesh operations, texture baking, slicing, and native project serialization.
2. The browser owns presentation and interaction: viewport, camera, picking, gizmos, brush cursors, panels, and keyboard input.
3. The bridge exposes versioned operations; it must not reimplement geometry algorithms in JavaScript when upstream C++ already has them.
4. Every optional feature is advertised through capabilities. The host must never infer support from the existence of a symbol.
5. Long-running operations are asynchronous, cancellable, and report progress.
6. Project edits are transactional. A failed operation must not leave a partially mutated project.
7. Every edit must round-trip through native 3MF where the desktop format supports it.
8. Keep upstream data semantics and coordinate conventions. Avoid lossy conversions between the browser and native project representation.

## Existing API boundary

The current OrcaWasm API 0.7.0 provides:
- session creation/disposal and configuration initialization;
- full profile initialization/application (format support is capability-advertised);
- project mesh/object/instance manifest input and readback;
- prepare operations (including documented arrange/auto-orient operations);
- project slicing, progress, cancellation and output assets;
- native project export;
- selected format conversion functions;
- capability discovery.

It does not currently expose a complete interactive editor API for cut, boolean, face painting, texture displacement, UV editing, mesh repair/simplification, or native GUI state.

## Proposed API modules

The following names are proposed contracts, not existing exported functions.

### A. project.model

- `project.model.get`: retrieve object/volume/instance hierarchy and transforms.
- `project.model.setTransform`: set instance or volume transform using the native matrix convention.
- `project.model.duplicate`: duplicate selected object/instance using native model semantics.
- `project.model.delete`: delete selected object/volume/instance.
- `project.model.setSelection`: host-side selection state is not persisted as geometry unless upstream does so.
- `project.model.layOnFace`: orient a selected model against a selected triangle/face normal.
- `project.model.arrange`: call the upstream Arrange implementation.
- `project.model.autoOrient`: call the upstream orientation implementation.

Browser responsibilities: hit-testing, selecting handles, numeric inputs, drag gestures, camera and viewport.

### B. project.mesh

- `project.mesh.cut`: invoke upstream mesh cut/split logic with a plane and options.
- `project.mesh.boolean`: union/subtract/intersect through the upstream Boolean implementation.
- `project.mesh.repair`: invoke upstream repair and return repair statistics.
- `project.mesh.simplify`: invoke upstream mesh simplification with an explicit target/error budget.
- `project.mesh.getGeometry`: return a renderable preview mesh and stable face/triangle identity mapping.
- `project.mesh.getBounds`: return native geometry bounds.

All operations must return explicit source-to-result identity mapping when available. If topology changes invalidate face selections or paint masks, the bridge must report that fact rather than silently retaining stale IDs.

### C. project.paint

Separate paint tools by semantic purpose:

- `project.paint.support`: support enforcer/blocker face masks and brush/fill operations.
- `project.paint.seam`: seam preference/forbid face masks.
- `project.paint.color`: filament/material assignment to faces/regions.
- `project.paint.textureDisplacement`: painted masks for each displacement layer.
- `project.paint.variableLayerHeight`: layer-height profile editing if the upstream implementation supports the required operation.

The browser may implement brush stroke sampling and surface hit-testing, but the face/triangle selection semantics, native mask representation, and slicing impact must be compatible with upstream code.

### D. project.textureDisplacement

- `project.texture.listAssets`: built-in/available texture assets, without assuming the desktop texture library's OS path layout.
- `project.texture.addLayer` / `removeLayer` / `updateLayer`: native layer stack.
- `project.texture.uploadAsset`: store PNG/JPEG/BMP bytes as a project-owned asset.
- `project.texture.paintStroke`: update the native per-layer face mask from browser-generated face IDs/brush parameters.
- `project.texture.unwrap`: invoke the native UV unwrap and return chart/island information.
- `project.texture.updateUV`: update island placement, seams, and UV edits.
- `project.texture.preview`: asynchronously generate preview geometry without committing it.
- `project.texture.bake`: invoke the native TextureBake/TextureDisplacement pipeline and commit resulting mesh.
- `project.texture.cancel`: cancel preview/bake safely.
- `project.texture.getStatus`: return progress and current operation state.

The engine must preserve layer order, projection mode, tiling, blending, texture image bytes, paint masks, UV seams/islands/edits, and bake state. Do not approximate texture displacement in JavaScript.

### E. project.profile

- expose the full native printer, filament, process and object-level configuration schema;
- expose defaults, inheritance, constraints, enum choices, and compatibility metadata;
- apply configuration fragments using native config validation;
- distinguish UI display metadata from engine values;
- support per-object/per-volume overrides.

The browser must not maintain a second hand-written source of truth for config definitions if the upstream config system can be queried/exported.

### F. project.export

- native 3MF export with full model, profiles, modifiers, face painting, texture layers, image assets, UV edits and sliced artifacts where supported;
- import/export round-trip diagnostics listing unsupported or dropped metadata;
- never silently discard unknown archive entries or native project metadata.

## Capability document proposal

Extend the engine capability document with feature IDs such as:

- `editor.model.transform`
- `editor.model.duplicate`
- `editor.model.layOnFace`
- `editor.mesh.cut`
- `editor.mesh.boolean`
- `editor.mesh.repair`
- `editor.mesh.simplify`
- `editor.paint.support`
- `editor.paint.seam`
- `editor.paint.color`
- `editor.paint.textureDisplacement`
- `editor.texture.layers`
- `editor.texture.unwrap`
- `editor.texture.preview`
- `editor.texture.bake`
- `editor.profile.fullSchema`
- `editor.project.3mfRoundTrip`

Each feature must return `supported`, `unsupported`, or a more specific status with a reason and API version. UI tools are enabled only when the required capabilities are present.

## Native code areas to investigate for each API

| API area | Upstream source areas | Integration concern |
|---|---|---|
| Model transform / arrange | `Model.cpp`, `ModelArrange.cpp`, `Orient.hpp` | transform conventions, plate/object/instance hierarchy |
| Cut / Boolean / repair | `CutUtils`, `MeshBoolean.cpp`, `MeshRepair.cpp`, `TriangleMesh` | CGAL/OCCT dependencies, topology identity |
| Support paint | `TriangleSelector`, `GLGizmoFdmSupports`, support metadata in `bbs_3mf.cpp` | face masks and native 3MF preservation |
| Seam paint | `TriangleSelector`, `GLGizmoSeam`, `SeamPlacer`, `bbs_3mf.cpp` | paint semantics must affect G-code seam placement |
| Color paint | `GLGizmoMmuSegmentation`, `TexturePainting`, `TextureToColor` | OpenCV availability, filament IDs, face attributes |
| Texture displacement | `TextureDisplacement`, `TextureBake/*`, `GLGizmoTextureDisplacement` | image decode, UV, paint mask, preview, bake, 3MF |
| Variable layer height | layer-height profile code and GUI tools | profile semantics and 3MF persistence |
| Full profile config | `PrintConfig`, `Preset`, `PresetBundle`, config definitions | schema generation, inheritance and validation |

## Required test strategy

### Native equivalence
For the same project and parameters, compare browser-engine results with desktop OrcaSlicer:
- transforms and object hierarchy;
- arrange/orient output;
- cut/boolean/repair geometry;
- face masks and paint data;
- texture bake mesh and attributes;
- profile values and resolved inheritance;
- G-code output and warnings.

### 3MF round-trip
For each editable feature:
1. Open a desktop-created 3MF.
2. Read it in the browser engine.
3. Make one edit.
4. Export a new 3MF.
5. Open it in desktop OrcaSlicer.
6. Confirm settings, assets, face masks, UV data, modifiers and geometry survive.

### Failure safety
- Abort during preview/bake.
- Invalid face IDs after topology changes.
- Missing texture asset.
- Unknown future 3MF metadata.
- Out-of-memory on high triangle counts.
- Browser tab reload during export.
- No partial commit on failure.

## First implementation milestone

Do not start by building every editor API. Start with a vertical slice that proves the architecture:

1. Import a native 3MF.
2. Display its mesh in a browser viewport.
3. Move/rotate/scale one instance through the native model transform API.
4. Save as 3MF through the native exporter.
5. Reopen the result in desktop OrcaSlicer and verify transforms and settings.

Once this works, add one mesh operation and then one paint feature. Texture Displacement should be the first advanced-feature proof because the v2.5.0 source has a substantial core implementation in `libslic3r`, but its full UI path is strongly coupled to the desktop Gizmo/UV editor.
