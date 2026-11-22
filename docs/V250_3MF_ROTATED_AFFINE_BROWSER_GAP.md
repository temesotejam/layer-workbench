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
