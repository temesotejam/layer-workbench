# Rotated/nonuniform Core 3MF: native/viewer anchor-spacing gap

Recorded 2026-11-22 against the pinned OrcaSlicer v2.5.0 pthread WASM
candidate and isolated Chrome, via PR #178. **Diagnostic, not parity.**

## Controlled fixture

`scripts/make_3mf_two_build_fixture.py --rotated-scaled` produces a
synthetic two-build Core 3MF. Its first 20-mm cube has a local nonuniform
scale (1.5, 0.75, 1.25), followed by +30 degrees around Z, with the original
build translation (90, 90, 0) mm. The second cube retains its identity
linear transform and translation (150, 90, 0) mm. All source assets are
generated in CI; no original user project or official vendor profiles are
modified.

## Observed result

- Both native WASM and ThreeMFLoader report two instances/build items.
- Native manifest ID/reference/matrix shape audits pass.
- The native-vs-viewer **multiset of 3x3 linear matrix parts is consistent**
  at the existing 1e-5 coefficient tolerance.
- Independently predicted Three.js bounds for *both* transformed and
  unchanged cubes agree with the real browser at 0.02 mm tolerance.
- **Native-vs-viewer transform-anchor pair spacing is a mismatch** at the
  existing 0.05 mm tolerance. The earlier translation-only fixture remains
  consistent. This was observed in [the first Chrome CI run](https://github.com/temesotejam/layer-workbench/actions/runs/44985809557),
  which correctly failed the initial optimistic assertion.

The discrepancy may arise from engine mesh normalization/instance pivot
conventions versus the raw Core build-item transform; this explanation has
**not** been proven. The separate linear-part and pair-spacing comparisons
also cannot establish a unique instance correspondence.

## Acceptance criteria before clearing this gap

1. Inspect the original Core build matrices and the native
   `getManifest()` instance/mesh representation for this fixture without
   exposing user-supplied coordinates or identifiers in logs.
2. Compose the instance transforms with their actual mesh vertices or local
   bounds and compare **world-space geometry** against Three.js for each
   build item. Do not substitute transform translation anchors for mesh
   placement under rotations/nonuniform scale.
3. Test swapped order, rotations, reflections and distinct meshes, with
   fail-closed ambiguity, in the isolated localhost environment.
4. Keep production Pages unchanged and the local diagnostic read-only.

This does **not** establish native desktop 3MF project parity, editing and
re-saving, full metadata compatibility, G-code equivalence, or printable
output.

## Follow-up: bounded native-converted world-facet gate

The isolated Prepare inspector now optionally compares the triangle
coordinates of the **real v2.5.0 WASM `threeMfToStl(original3mf)` output**
against the independently rendered ThreeMFLoader triangles after undoing
only the known viewer root translation. It compares full world-space
triangle vertex sets, not just instance transform anchors or bounding boxes.
The matching is order- and winding-independent with a 0.05 mm per-axis
threshold, and uses a complete bipartite matching for duplicate faces.

The test is limited to **256 total triangles** and unedited Core 3MF
build-item scenes under a translation-only viewer root. Any unsupported
mesh, modified object, malformed binary STL, excessive geometry or missing
native conversion yields `unavailable`; a valid but different triangle
set yields `mismatch`. No raw vertices, paths, private IDs or original
project metadata are emitted in the status. The real Chrome CI explicitly
checks both the basic two-build fixture and the rotated/nonuniform fixture.
A future green CI run establishes only the combined rendered geometry
comparison for those fixtures, not desktop project parity.

**Important:** The native converter yields a flattened STL. Therefore the
comparison cannot attribute a converted triangle to its original native
instance or identify the native importer's local mesh pivot. It does NOT
resolve the previously observed native/viewer **transform-anchor spacing
mismatch**; that diagnostic remains a mismatch until its frame convention is
derived. Per-instance matching, nested components, 3MF edit/save,
manufacturer profiles, G-code parity and print safety remain outstanding.
The published GitHub Pages workspace and WASM candidate are unchanged.

## Distinct-resource/reordered-build regression (proposed)

The original two-item synthetic Core fixture references the **same 20-mm cube
resource twice**. A global 24-triangle match may miss an incorrect assignment
between those identical instances. A new opt-in isolated Chrome fixture now
uses two actual mesh resources: the rotated/scaled 20-mm cube and a separate
10 × 15 × 25-mm rectangular solid. The Core `<build>` items are deliberately
reversed while retaining their original transforms and object references.

The browser integration gate checks both displayed per-build world bounding
boxes independently and uses the original read-only real WASM 3MF-to-STL
conversion to compare the combined 24 world triangles. It also verifies that
the inspector does not modify the viewer or enable unverified 3MF slicing.
The fixture is produced on demand inside CI, with no vendor files included.

This increases coverage of object-reference/order handling; **flattened STL
still cannot prove native instance-ID equivalence** or explain the remaining
transform-anchor mismatch. The acceptance result must be taken from a
successful isolated-Chrome CI run rather than from generation of the fixture
alone. 3MF editing/saving, desktop G-code parity, and print safety remain
unproven.
