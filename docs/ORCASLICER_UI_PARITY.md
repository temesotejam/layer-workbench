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

The current browser page is an early layout scaffold. It has a three-column Prepare-like frame, a build-plate visual placeholder, a local file list, and a settings panel shell. It does not parse geometry, display imported meshes, share state with the C++ engine, or expose native editing operations. Controls remain disabled when their underlying operation is not implemented.

Navigation now reflects the v2.5 desktop page families: Home, optional Design, Prepare, Preview, Device, Multi-device, Project and Calibration. Unsupported pages remain disabled rather than pretending to work.

## Required work for close visual/behavioral parity

1. Compare reference screenshots from the official v2.5.0 desktop app at fixed window size, scale factor, and dark/light theme. Record panel widths, toolbar height, spacing, typography, icons, and tab order.
2. Recreate the native top-level hierarchy: app/menu and toolbar, workspace notebook, Plater toolbars, plate strip, object tree, parameter sidebar and status area.
3. Implement a real WebGL viewport and STL/OBJ/3MF geometry loading; remove the decorative build-plate-only placeholder.
4. Connect the engine session, project manifest, native transforms, arrange/auto-orient, profiles and slicing.
5. Implement Preview with layer/toolpath visualization and G-code controls.
6. Implement device, calibration, project and optional plugin workflows only where their browser permissions/backends exist.
7. Add screenshot-based visual regression at defined desktop viewport sizes and interaction tests for every enabled control.

## Important technical constraint

The native UI is implemented with wxWidgets, GLCanvas3D, native event loops and platform integrations. Those widgets cannot simply be displayed in a browser by compiling the current headless WASM engine. A browser-native UI can reproduce the layout and behavior, but pixel-perfect matching and full behavioral parity require a substantial, staged frontend port. Do not claim completion based on a similar-looking mockup.
