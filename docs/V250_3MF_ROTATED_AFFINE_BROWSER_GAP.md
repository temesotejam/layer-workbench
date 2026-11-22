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

## Affine frame offset diagnostic (2026-11-22)

The opt-in localhost inspector adds an independent **affine frame offset**
classification using only one-slicer-api 0.7.0 instance matrices and the
currently rendered Three.js build-item world matrices. It matches row-major
native and column-major Three.js **3×3 linear parts**. For duplicated
rotations/scales, it now also tests all possible one-to-one assignments under
a **single common translation**, accepting only a unique full assignment.
Coincident placements or multiple valid assignments remain `ambiguous`.
Where linear parts uniquely identify items, it checks whether
the per-instance translation deltas all equal one global viewer-root offset
within 0.05 mm. Results: common-offset, instance-dependent, ambiguous,
linear-mismatch, or unavailable; the UI and logs do not show coordinates,
internal IDs, source filenames, or matrix values.

The rotated and nonuniform Core fixture is required to show
instance-dependent in isolated Chrome alongside the existing anchor-spacing
mismatch. This tests whether a single 128-mm bed translation explains the
gap: it does **not** claim an import pivot correction. The original
translation-only two-cube fixture now yields `common-offset` **only** because
its two separated anchors admit exactly one shared-translation matching,
despite identical linear transforms. This is still a constrained alignment
hypothesis, not independent confirmation of native object IDs. Native-converted flattened triangles must
still pass independently; the two diagnostics measure different properties.

This is a diagnostic classification, **not** native instance identity, per-mesh
local vertex attribution, desktop 3MF parity, or permission to edit/export/slice
a real print. The published workspace is unchanged.

## Bounded affine-frame matching regression (2026-11-22)

The localhost-only affine frame classifier now uses polynomial-time
augmenting-path bipartite matching instead of enumerating all candidate
instance permutations. The previous search could take factorial time for an
adversarial 64-instance case where each native transform matched the same
63 viewer transforms but no complete matching existed. Untrusted 3MF input
must not be allowed to stall a browser diagnostic.

The regression tests include (1) that Hall-deficient 64-instance case,
(2) a valid 64-instance reversed-order common translation, and (3)
coincident instances that must remain `ambiguous`. The result categories,
bounded 0.05 mm/1e-5 tolerances, and privacy-safe summaries are unchanged.
This protects diagnostic responsiveness; it does **not** identify native
mesh-local vertices, resolve the rotated anchor mismatch, or prove desktop
3MF / G-code parity. No production Pages integration or WASM binaries change.

## Bounded viewer-build facet partition (2026-11-23)

The localhost-only 3MF inspector now asks whether triangles from the **flattened**
native WASM 3MF-to-STL conversion can be assigned to the geometry of *each
independent ThreeMFLoader build item*. It accepts only a full, bounded
(256 triangles / 64 build items) world-facet match where every native
triangle has a candidate match in exactly one viewer build. Duplicated or
overlapping build triangles yield `ambiguous`, malformed/oversized input
`unavailable`, and disagreements `mismatch`. The status reports only
classification, build count and triangle count, never source coordinates.

This is a more specific **viewer-build separability witness** than global
triangle-set equality. It cannot recover any native build/object ID from the
flattened STL or establish native mesh-local vertices, pivots, desktop project
save compatibility, or print safety. The rotated anchor discrepancy remains
open. Only a green isolated Chrome CI on the pinned v2.5.0 candidate confirms
the end-to-end synthetic-fixture result.

## Shared native mesh local-origin hypothesis (2026-11-23)

The read-only isolated Prepare inspector now tests a narrowly stated alternative to a simple common bed offset. For native one-slicer-api 0.7.0 instances that refer to the **same manifest mesh ID**, it first requires a unique native/viewer pairing by the full 3×3 linear transform, independent of array or build order. When three or more independently transformed instances share that mesh and at least one relative 3×3 transform is invertible, it solves the hypothesis `nativeTranslation − viewerTranslation = commonRootOffset + linearTransform × sharedLocalReframe` and checks every sibling against the same inferred local-origin shift and root offset. Matrices and fitted coordinates stay local and are never reported.

The classifier returns `hypothesis-consistent`, `hypothesis-mismatch`, `underdetermined`, `insufficient-shared-instances`, `ambiguous`, `linear-mismatch` or `unavailable`, with only a bounded witness count. An exact fit from *only two* transformed instances is **not independent evidence** for any native pivot convention; these are reported `insufficient-shared-instances`. Repeated linear transforms with nonunique correspondence also remain `ambiguous`. The existing two-build rotated Core fixture therefore cannot prove a local reframe, even though the flattened world-space facets match; the original anchor-spacing mismatch remains open. Synthetic three-transform unit tests exercise successful and rejected hypotheses.

This is a constrained **mathematical compatibility check**, not a native mesh-vertex readback, proof of importer normalization, desktop UI parity, 3MF round-trip, G-code equality, or permission to print. Next acceptance requires an independently transformed third build of the same Core mesh, then a real isolated Chrome/WASM residual result and native mesh-local vertex/bounds verification. No production Pages engine is activated.

## Three-build source Core mesh versus native manifest identity (2026-11-23)

An independent synthetic Core 3MF now contains **three build items that all
reference the one original Core object/mesh**. Its affines are a rotated
nonuniform transform, identity, and independent (0.8, 1.2, 0.9) scaling.
The 3MF is constructed and audited inside CI; the isolated Chrome test loads
it through the pinned official v2.5.0 WASM candidate and ThreeMFLoader.

The *actual* first Chrome run
[#45051023095](https://github.com/temesotejam/layer-workbench/actions/runs/45051023095)
showed: three viewer builds; **three native instances, three native objects,
three native meshes**; 3×3 linear parts consistent; **native/viewer anchor
spacing mismatch**; 36 converted world facets consistent and separable by
viewer build. The shared-local-origin classifier correctly returned
`insufficient-shared-instances` with zero matched instances. The acceptance
assertion expecting a 3-witness residual FAILED. That test was overly
optimistic: the native importer exposes distinct internal mesh IDs for
original Core build items sharing one resource, so a solver that groups on
native manifest mesh IDs cannot obtain a three-member group.

The corrected test explicitly preserves and checks the observed
per-build native mesh cardinality and the fail-closed residual status.
It must **not** equate identical source object IDs, converted world facets,
or native mesh counts with a proven common importer pivot. A future
acceptance gate needs a trustworthy source-resource-to-native-mesh
correspondence (or independently retrieved mesh-local geometry) before
testing a reframe residual. This new regression is *not* 3MF project
round-trip, desktop G-code parity, or printer safety. Public Pages
remains unchanged.
