# v2.5.0 diagnostic 3MF manifest mesh-byte range guard

This is a **development-only one-slicer-api 0.7.0 manifest adapter**, not a native 3MF archive editor. The isolated Chrome acceptance test constructs a pair of synthetic STL meshes and calls `setObjects(blob, manifest)` before requesting a manifest-only instance transform. Replacing the session project in this way **cannot preserve opaque 3MF metadata**.

Before a transform is returned, `scripts/native-manifest-edit.mjs` now checks any explicitly declared mesh `dataRange` on **every** mesh, including an unselected or unused one:

- Offset is a nonnegative safe integer; length is a positive safe integer.
- The calculated end offset must remain a safe integer.
- When the caller supplies the **actual original binary blob length**, every explicit range must fit inside it, and that blob length must be positive and no larger than the existing 80 MiB local test limit.
- Legal mesh sharing, shared byte ranges, object sharing and sibling transforms are retained. The diagnostic does **not** require ranges to be disjoint.
- Some imported native manifest readbacks may not expose a `dataRange`. Such entries remain unmodified and **are not asserted to have valid binary backing**; the guard never fabricates a range.

The isolated Chrome test passes `blob.byteLength` from the same `Uint8Array` that is submitted through `setObjects`. Unit tests cover negative/fractional/zero/string/overflow ranges, insufficient blob lengths, an unrelated invalid mesh, and a valid shared-byte example. The accepted-candidate 3MF workflow executes both the unit tests and the real Chrome test without rebuilding the large WASM engine.

This only prevents a narrow class of corrupt manifest data from being passed onward as a successful instance edit. It neither validates the contents of STL bytes, proves a real desktop-created 3MF round-trip, preserves unknown ZIP members, nor establishes native-vs-WASM G-code parity or print safety. Published Pages remains unchanged and the local diagnostic is not promoted into the production editor.
