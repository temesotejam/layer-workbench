# Native v2.5.0 vs WASM: diagnostic G-code with unequal inputs

The existing `scripts/check_parity_pair.py` requires SHA256 identity for the
source model and all three resolved machine/filament/process inputs **before**
running a strict G-code comparison. This gate intentionally blocks current
full-native vs restricted-WASM presets, which do not represent equivalent
effective settings. Do not bypass or relabel this condition as parity.

For investigation only, use the **explicit** opt-in:

```bash
python3 scripts/check_parity_pair.py \
  --native-manifest /path/to/native/manifest.json \
  --wasm-manifest /path/to/wasm/manifest.json \
  --min-extrusion-moves 100 \
  --diagnose-mismatched-inputs \
  --report /path/to/diagnostic-report.json
```

The manifests are separately produced from input files by
`scripts/make_parity_manifest.py` and self-report their producer role.
The input hashes are verified on disk; this **does not authenticate** the
native executable, WASM artifact, profile semantics, model equivalence,
source revision, or geometry placement. An independent producer log and
source pin are required. The raw source profiles and executable diagnostic
G-code should remain in the isolated CI runner or localhost, not Pages.

When machine/filament/process/model SHA256 differs, diagnostic mode still
computes ordered G-code differences, commanded positive-E length and G1
straight deposited-XY length. It reports `different_inputs`,
`input_hashes_match: false`, `diagnostic_only: true`, and `match: false`;
the CLI **exits 1**, even if the commands happen to match. A malformed
manifest still fails rather than yielding a numeric comparison.

Without the opt-in, unequal inputs continue to return immediately with no
G-code comparison. Even when all input hashes match, matching commands alone
are not proof of executable provenance, full OrcaSlicer parity, toolpath
safety or physically print-ready G-code.

## Remaining acceptance work

Generate both real native and isolated-Chrome WASM G-code outputs using
**the same STL bytes, placements and complete effective v2.5.0 profiles**,
while preserving independent artifact/provenance hashes. Current official
native CLI fixture uses full resolved source-pinned presets, while the
browser one-slicer-api forwards a restricted subset, so a *true*
equal-input pair cannot yet be claimed. Diagnostic mode allows recording
the observed differences without confusing them with a successful parity
check. Do not deploy the WASM engine to the public Pages app.

## Shared source STL milestone (2026-11-17)

`scripts/parity-cube-fixture.mjs` now owns one synthetic binary STL
source for **both** the isolated Chrome/WASM single-cube smoke probe and the
official native v2.5.0 CLI probe. The 12-triangle 20 mm cube must hash to
`7b59223183b5c34815cbf197e1207b108932779a650bd9e6c9a6d2be811f8e93`
(SHA256 of 684 raw STL bytes, including the header and normals). An offline
test checks the complete bytes, triangle count, bounds and edge manifoldness.
The Chrome test records this source digest alongside its generated G-code
summary; the native CI generates exactly the same STL and **attempts** a
separate official full-preset slice, keeping raw outputs ephemeral and only
archiving hashes, bounded counts and logs.

This establishes **source model-byte identity only** when both CI runs pass.
The existing native test automatically arranges its STL; the localhost WASM
test uses its own project placement and a restricted development profile,
whereas the native runner loads full upstream-pinned machine, filament and
process presets. Therefore the resulting G-code files must **not** yet be
called a same-placement/same-effective-profile parity pair. Comparing their
hashes or aggregated counts is not a valid equivalence verdict. The next
gate is to align the two object-to-bed transforms and capture explicit
effective configuration bytes from both engines in the same isolated runner
before invoking `check_parity_pair.py`; unequal settings must remain
diagnostic-only with a nonzero exit status. Never deploy the diagnostic
G-code or WASM candidate to public Pages or treat the result as print-safe.

## Explicit placement gate for the shared cube (2026-11-17)

The browser's isolated one-slicer-api manifest for the unchanged synthetic
20 mm cube specifies the affine instance translation `(128, 128, 0)` in
millimetres. Both the single- and multi-STL manifest creators now have a
pinned regression assertion for the corresponding 4x4 matrix.

The official native v2.5.0 CLI previously sliced the same 684-byte STL with
`--arrange 1`, which left the native object location unrelated to that
browser manifest. `scripts/wrap_parity_cube_3mf.py` now takes those **exact
original STL bytes**, verifies their SHA256, preserves all 12 source triangles
and writes a minimal independent Core 3MF containing the explicit 3MF build
translation `128 128 0`. The source STL remains unchanged. The native CI
uses `--arrange 0`, exports the loaded 3MF back to STL, and **fails closed**
if the actual geometry does not consist of 12 triangles with XYZ bounds
`[128,148] x [128,148] x [0,20]` before attempting the native slice.

This is an **input placement and geometry alignment probe**, not a paired
G-code parity verdict. Native CLI imports a Core 3MF wrapper whereas the
browser WASM path imports raw STL, and the native engine receives complete
source-pinned profiles whereas WASM receives only restricted development
settings. The test does not demonstrate identical slicer-internal
positioning, mesh processing or G-code. Both command streams must still be
captured with fully resolved equivalent settings and compared, and any
mismatched inputs must retain `diagnostic_only`/FAIL status. Neither the
3MF wrapper nor diagnostic G-code is deployed to Pages or declared printable.
