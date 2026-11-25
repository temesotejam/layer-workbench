# OrcaSlicer v2.5.0 desktop UI parity map

This is a source-based implementation map for the browser UI. The desktop GUI is wxWidgets-based; it is not compiled into the headless WebAssembly engine. The browser interface therefore needs a deliberate web implementation of the same workflows and visual hierarchy. It must not be represented as pixel-identical until compared against desktop screenshots at matching resolution and theme.

## Verified upstream structure (tag v2.5.0)

Source: `src/slic3r/GUI/MainFrame.cpp`.

- In the editor layout, the native notebook creates Home (when editor mode is enabled), Prepare, Preview, Device, optional Multi-device, Project, Calibration, and plugin pages.
- The Old layout inserts Prepare and Preview immediately after Home (or at the start if Home is absent).
- Design is conditional on the optional CAD feature and is not part of the default layout.
- Prepare and Preview share the Plater page; switching tabs changes the active 3D toolbar mode and preview behavior.
- The application has a distinct Device/Monitor page and optional web-device page.

Source: `src/slic3r/GUI/Tab.cpp`.

- Preset/settings UI is a native panel with preset selection, save/delete/search controls, category pages, option groups, and printer/filament/process configuration.
- The sidebar is not merely a generic static form; it is tied to preset/config state and the active Plater.

Source: `src/slic3r/GUI/Plater.cpp` and `GUI_ObjectList.cpp`.

- Plater combines the 3D canvas, object/volume/instance list, plate selection/management, plate toolbar, object context operations, and the settings sidebar.
- The viewport uses the native GLCanvas3D/Gizmo system. A web port must implement camera, picking, transform gizmos, selection, and render-state synchronization rather than only draw a decorative plate.

## Browser implementation status

The published Prepare page has a Three.js WebGL viewport with local STL, OBJ and 3MF loading, model selection/picking, a transform gizmo, XYZ/rotation/scale inputs, deletion, Fit, and **working 3D/Top/Front camera views** (Z-up; the Front view looks along +Y from the -Y side). The camera buttons adjust only the viewport; they do not modify model transforms or invoke a native project operation. The browser also supports **drop selected STL/OBJ to bed**: the minimum world-space geometry Z is moved to the viewer's logical build plate Z=0 while X/Y, rotations and scaling remain unchanged. The command is restricted to loose meshes (not 3MF) and remains browser-only, without native arrange/collision handling or project saving. Real Chrome tests exercise source and duplicated mesh placement independently. The browser also supports **duplicate selected STL/OBJ**, making a second independently selectable scene object offset by +20 mm in X and Y while sharing read-only geometry buffers and cloning materials for isolated highlighting. Source and duplicate transforms can be edited or deleted independently; the source file is unchanged. This is viewer-only (no native project instance/save), and duplication remains **disabled for 3MF** until native instance/volume semantics are validated. The real Chrome UI smoke exercises duplicate, independent edits, and deletion. These remain **browser-only edits**, not native OrcaSlicer project edits or a desktop-accurate viewport. Slice, profile selection and unsupported tabs remain disabled on the public page. A separate explicit isolated-localhost lab exercises the WASM candidate without publishing that engine.

Navigation now reflects the v2.5 desktop page families: Home, optional Design, Prepare, Preview, Device, Multi-device, Project and Calibration. Unsupported pages remain disabled rather than pretending to work.

## Required work for close visual/behavioral parity

1. Compare reference screenshots from the official v2.5.0 desktop app at fixed window size, scale factor, and dark/light theme. Record panel widths, toolbar height, spacing, typography, icons, and tab order.
2. Recreate the native top-level hierarchy: app/menu and toolbar, workspace notebook, Plater toolbars, plate strip, object tree, parameter sidebar and status area.
3. Extend the existing WebGL viewport and STL/OBJ/3MF import beyond basic camera, object picking and transform tools to match native scene hierarchy and view behavior.
4. Connect the engine session, project manifest, native transforms, arrange/auto-orient, profiles and slicing.
5. Implement Preview with layer/toolpath visualization and G-code controls.
6. Implement device, calibration, project and optional plugin workflows only where their browser permissions/backends exist.
7. Add screenshot-based visual regression at defined desktop viewport sizes and interaction tests for every enabled control.

## Important technical constraint

The native UI is implemented with wxWidgets, GLCanvas3D, native event loops and platform integrations. Those widgets cannot simply be displayed in a browser by compiling the current headless WASM engine. A browser-native UI can reproduce the layout and behavior, but pixel-perfect matching and full behavioral parity require a substantial, staged frontend port. Do not claim completion based on a similar-looking mockup.


## 2026-11-23: viewer-only transform Undo / Redo

The public Prepare workspace now provides bounded (50-step) Undo / Redo for
**browser transforms only**: numeric position/Z rotation/XYZ scale edits,
TransformControls drag gestures and Drop to bed. It restores position,
quaternion, scale and the viewer-modified flag. New edits invalidate redo.
Importing clears the transform stack. Deleting a native 3MF build item in the isolated viewport also clears earlier
history but now supports viewer-only Undo/Redo of that deletion. No native
project changes are performed. Loose STL/OBJ duplication **and deletion**
clear earlier transform history but create reversible structural actions:
Undo removes only the copy from the viewport and Redo restores the *same*
copy, including its independently cloned materials and transforms. Undo of a
loose-mesh deletion restores its original scene object, transform, identity and
list position; Redo removes it again, even when it was the final object.
New editing after an undone structural action discards that Redo. No deleted
mesh is reloaded from disk, and the source file remains unmodified.
3MF duplication remains
disabled; native 3MF instance or project history is **not** supported. Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y work
outside editable fields; input elements keep native text editing shortcuts.

These controls never rewrite source STL/OBJ/3MF files or native projects.
The pure history unit tests and real Chrome UI tests run in
`browser-e2e.yml`. This does not reproduce the native OrcaSlicer command
history, undo imports, native 3MF project edits or deletions, or certify native 3MF editing.
The public WASM slicing function remains disabled.

## 2026-11-23: reversible 3MF viewport deletion (not native editing)

The browser's 3MF *displayed scene* can now be removed and restored with
Undo/Redo without reparsing or overwriting its source file. In normal public
Prepare mode, the ThreeMFLoader scene is one viewport item. Under the explicit
localhost, COOP/COEP-isolated `?engineLab=1` diagnostic, individual Core build
items can be detached and restored to the same source root, including its
original relative child order and the special case of deleting the final
build item and temporarily removing the root from the Three.js world.

This operates only on the existing in-memory Three.js object references.
It does **not** change 3MF Core build transforms, the native/WASM one-slicer-api
manifest, project metadata, native save/export or slicer print geometry.
Imported 3MF source bytes remain untouched. Other viewer history is still
cleared on structural deletion, so this is **one reversible deletion action**,
not a complete project command stack. 3MF duplication remains unsupported.

The browser CI generates an independent synthetic Core 3MF with two build items,
tests deletion/Undo/Redo in regular Chrome and isolated Chrome, and checks that
a final-child deletion can be reversed without losing the scene root. The
public Pages deployment still does not enable unverified WASM features.


## 2026-11-25: frame all visible Prepare models

The v2.5.0 source-pinned [MainFrame.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/MainFrame.cpp) describes selecting a camera direction and zooming to all objects. [GLCanvas3D.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/GLCanvas3D.cpp) distinguishes volume and selection bounding boxes. In the browser, the 3D/Top/Front direction controls and the explicit Fit all button now frame the union of the current viewer entries' world-space bounding boxes, not merely the selected entry. Fit retains its selection-specific behavior; empty Fit all falls back to the plate view. This changes only the camera, never selection, history, geometry, source bytes, native state or WASM enablement. The existing real Chrome regression checks a displaced duplicate, selection/transform/history preservation and empty-scene behavior. This is an independent browser implementation, not pixel-level desktop camera parity or orthographic projection.
