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


## 2026-11-25: perspective fit for deep models and narrow viewports

The source-pinned desktop [Camera.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Camera.cpp) projects box vertices into camera axes to calculate viewport zoom. The independent browser perspective fit now accounts for the near face of deep bounds in Top/Front and the narrower frustum angle in 3D (conservative enclosing sphere). The orbit distance limit expands when needed. Four analytic regressions cover deep, narrow, small and invalid bounds; existing Chrome interaction tests remain enabled. This is not desktop camera equivalence, and distant geometry fog and interactive resizing are outside this test. No engine activation or source-file edits.

## 2026-11-25: additional axial Prepare directions

The pinned [Camera.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Camera.cpp) selects left from -X, right from +X and rear from +Y, with +Z up. The browser now has these three additional direction buttons in the viewport, a selected-direction label and direction-specific perspective framing (side view uses Y width and X depth). The existing 3D/Top/Front controls remain. Unit tests cover the axis vectors and side/rear framing; the Chrome regression checks direction selection, single active button, label and unchanged model transforms. The native directional views may be orthographic; the browser is still perspective. Bottom and top-front remain unimplemented; the double-sided plate would obscure a bottom view. No native editing or WASM activation.


## 2026-11-25: underside Prepare camera

The pinned [Camera.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Camera.cpp) defines Bottom as -Z with -Y up; [GLCanvas3D.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/GLCanvas3D.cpp) distinguishes above/below bed rendering. The browser adds Bottom with the same axis convention and perspective fit shared with Top. Its simple bed is front-facing only, grid visibility follows actual camera height, and the plate border remains visible from below. This independent rendering choice prevents the opaque browser plate from hiding the model underside. A unit regression checks axis and framing; the Chrome regression checks unchanged transforms, active button and actual rendered cube/bed contrast from below. This is not native orthographic projection, native bed rendering, 3MF editing, or public WASM activation.


## 2026-11-25: explicit orthographic Prepare projection

The pinned [Camera.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Camera.cpp) supports perspective and orthographic projections and automatically selects orthographic for axial directions unless the user has explicitly selected a projection. The browser implements an explicit Ortho toggle while preserving the existing perspective default and chosen view direction; toggling reframes all visible models. The active Three.js r180 camera is shared by rendering, picking and TransformControls, and OrbitControls is recreated when the camera or up axis changes (r180 caches the up-axis quaternion). Orthographic fit uses projected axial extents or an enclosing sphere for oblique views, and a narrower viewport preserves both fitted spans. Unit tests cover axial depth independence, portrait fit and invalid bounds; the Chrome regression checks rendering, wheel zoom, switching back and transform/history preservation. Native automatic projection selection, exact native zoom factors, pixel-level parity, native editing and public WASM activation remain out of scope.


## 2026-11-25: optional automatic camera projection

The pinned [Camera.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Camera.cpp) implements `auto_type`: axial direction selection always chooses orthographic and clears the manual hold, while an oblique direction chooses perspective only when that hold is clear. [AppConfig.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/AppConfig.cpp) defaults `auto_perspective` to false. The browser Auto button implements this direction-selection policy for the existing seven directions; it is off at page load and changes only future direction choices, not model state. The explicit Ortho button sets the manual hold. Tests cover both projection policies, manual hold/release, and unchanged model transforms. This preference is session-local; native configuration persistence, top-front view, free-orbit automatic transitions and exact camera parity remain out of scope. No public WASM activation.


## 2026-11-25: center selected loose mesh on viewer plate

The pinned [Selection.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Selection.cpp) implements `Selection::center()` by translating selection bounds to the active plate center in XY only. The independent browser Center command moves one loose STL/OBJ using its transformed world geometry bounds to the fixed viewer plate center, preserves Z/rotation/scale and creates one reversible viewer transform. A no-op does not add history. The Chrome regression checks the displaced duplicate, unchanged source, Undo/Redo, no-op, and disabled state for empty/3MF scenes. This is not collision-aware arrangement, native model editing, multi-plate centering, printability validation or public WASM activation.


## 2026-11-25: numeric X/Y rotation and precise loose-mesh drop

The pinned [Selection.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Selection.cpp) uses instance minimum Z in `get_drop_min_z()` and translates by its negative in `drop()`. The browser previously used the transformed local bounding box, which can overestimate the actual extent of a tilted non-box mesh and leave it floating. Drop to bed now uses Three.js r180's precise transformed geometry bounds and refuses an active gizmo drag. New numeric X/Y Euler rotation inputs make tilted loose STL/OBJ edits reproducible and participate in existing quaternion-based Undo/Redo. A synthetic sloped tetrahedron tilted 45 degrees has actual minimum Z = 20/sqrt(2) mm but its cached-box minimum Z is zero; the Chrome regression verifies the actual correction, history, no-op and unchanged other axes. New numeric X/Y inputs are disabled for 3MF; no native 3MF editing, exact desktop Euler convention, print safety or public WASM activation is claimed.


## 2026-11-25: explicit loose-mesh placement check

The pinned desktop [GLCanvas3D.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/GLCanvas3D.cpp) calls native build-volume outside checks. The independent browser Check placement command instead checks the selected loose STL/OBJ's precise world vertex bounds against the fixed 256 × 256 mm viewer plane, reports minimum Z relative to the logical bed, and counts positive-area XY AABB overlaps with other loose meshes. Edge touching is not overlap. It runs only on demand, clears the report on selection or transform updates, and changes no scene state or history. Mixed 3MF scenes, invalid bounds and more than 64 entries are unavailable. The Chrome regression covers centered duplicates, separated models, rotated contact, outside placement, history preservation and disabled 3MF operation. This is not native build volume, actual collision detection, printer clearance, height-limit or printability validation; no public WASM activation.


## 2026-11-25: selected loose-mesh free-space placement

The pinned [ArrangeJob.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Jobs/ArrangeJob.cpp) separates selected and unselected instances and uses native arrange polygons. As a limited, independently implemented first step, Find space translates only the selected loose STL/OBJ in XY to the nearest feasible axis-aligned bounding-box position with a fixed 5 mm viewer margin and separation from fixed obstacles. The bounded candidate search uses actual transformed geometry bounds, does not rotate or move other objects, and is one viewer Undo/Redo action. If there is no fit or invalid input, nothing moves. Empty/3MF/mixed scenes and more than 64 entries are excluded. Tests cover exact overlap, already-clear, outside, oversized, blocked and invalid geometry as well as actual Chrome interaction. This is not native polygon nesting, full plate arrangement, print-head clearance, printability or public WASM activation.

## 2026-11-25: greedy all-loose-mesh viewer arrangement

The pinned [ArrangeJob.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Jobs/ArrangeJob.cpp) supports arranging all instances when selection is empty, using native polygons and plate constraints. The independent browser Arrange all button instead plans XY AABB moves for 2–64 loose STL/OBJ entries, placing larger footprints first with deterministic input-order ties, 5 mm viewer edge/separation clearance, and no rotation. Already-clear layouts are unchanged; an unsuccessful greedy pass applies no partial moves and does not prove that no packing exists. All changed snapshots form one bounded undo/redo action, retaining selection and other transform axes. Tests exercise pure packing, batch history and actual Chrome interaction. Mixed/3MF scenes remain excluded. This is not native nesting, printer-specific bed/clearance, multibed arrangement, printability or WASM activation.


## 2026-11-26: bounded fallback orders for viewer arrangement

The independent viewer AABB planner preserves its previous area-first result on success, but retries a failed plan with distinct width-first and height-first orders (at most three attempts). Each attempt starts from empty temporary placement, and no partial result is applied. Zero-displacement feasibility now bypasses candidate-grid enumeration. Tests cover a three-rectangle fixture where the former order fails but a fallback fits, its transpose, deterministic results, 64 clear objects, and impossible/invalid plans. The source-pinned [ArrangeJob.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Jobs/ArrangeJob.cpp) uses actual polygons, plate and exclusion constraints; these independent fixed-viewer AABB heuristics are not native polygon nesting, a complete packing search, printer clearance, or printability validation. No native engine, 3MF project or Pages WASM enablement change.


## 2026-11-26: corner-seeded fallback for viewer arrangement

A centered first footprint can prevent any of the three previous greedy orders from packing two identical rectangles, even when the plate has sufficient space. After every original order fails, the viewer now retries each distinct order with the first footprint preferred at the lower-left usable plate corner. All moves remain XY-only, and no partial placement is applied. The maximum is six distinct plans, and already-clear and previously successful plans are unchanged. Unit regressions cover two equal tall footprints and their transpose on a translated bed, deterministic moves, exact clearance, and idempotence. The pinned [ArrangeJob.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/slic3r/GUI/Jobs/ArrangeJob.cpp) uses native polygons, exclusion volumes and plate constraints; this independent AABB fallback is not native nesting, exhaustive packing, multi-plate planning or printability validation. No engine, project source bytes or WASM enablement change.
