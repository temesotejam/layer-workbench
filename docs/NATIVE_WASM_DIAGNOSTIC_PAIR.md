# Native v2.5.0 vs WASM: diagnostic G-code with unequal inputs

The existing `scripts/check_parity_pair.py` requires SHA256 identity for the
source model, source-bound placement witness and all three resolved machine/filament/process inputs **before**
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

When scene/machine/filament/process/model SHA256 differs, diagnostic mode still
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

## Real G-code pair, explicitly diagnostic only (2026-11-17)

The official native CLI workflow now optionally retrieves the **actual**
isolated-Chrome cube G-code archived in
[run 44032175782](https://github.com/temesotejam/layer-workbench/actions/runs/44032175782).
It compares this browser fixture to the actual native G-code generated from
the same byte-pinned 684-byte STL at explicit native XYZ bounds
[128,148] × [128,148] × [0,20] mm. The browser manifest specifies the
corresponding (128,128,0) translation. The comparison rechecks source
STL SHA256, browser summary SHA256/bytes, engine version and API.

`scripts/diagnose_live_cube_pair.py` outputs **numeric-only diagnostics**:
ordered-command mismatch counts, positive-E commands and filament-axis length,
G1 XY deposition length and G-code hashes. Raw executable G-code and
licensed full-profile contents are **not** archived by the native workflow.

The diagnostic always reports `parity_pass: false`, including when commands
happen to match. The native import uses Core 3MF and full official v2.5.0
source-pinned profiles; browser WASM loads STL and generic PLA development
settings. This archived browser run is also a historical source revision,
not a freshly co-built production pair. Its artifact expires in 14 days,
after which the workflow explicitly skips this optional comparison.
The archived browser summary had a known literal backslash-n suffix,
accepted only for this legacy diagnostic. New summaries write valid JSON.
This is real-engine *difference evidence*, not a same-full-profile G-code
parity verdict or safe-to-print validation.

## 2026-11-18: fail-closed placement witness for strict parity fixtures

The strict native-vs-WASM manifest gate now requires a sixth local input:
`scene.json`, in addition to `model.stl`, `machine.json`,
`filament.json`, `process.json`, and `gcode.gcode`. Both producers
must supply a **byte-identical canonical placement witness**; if its
SHA256 differs, `different_inputs` includes `scene` and parity fails
*before* G-code comparison unless `--diagnose-mismatched-inputs` is
explicitly selected. Diagnostic mode remains FAIL even if commands match.
A missing or malformed scene cannot be bypassed by diagnostic mode.

Required local `scene.json` shape (illustrative, not a real native result):

```json
{
  "schema": "layer-workbench-scene-v1",
  "units": "mm",
  "matrix_layout": "row-major",
  "source_model_sha256": "<64 lowercase hex SHA256 of model.stl>",
  "instances": [
    {
      "source_index": 0,
      "plate_index": 0,
      "matrix": [1, 0, 0, 128, 0, 1, 0, 128, 0, 0, 1, 0, 0, 0, 0, 1]
    }
  ]
}
```

Use the **same object order, identifiers, JSON encoding and numerical
representation** for both producers, otherwise fail closed rather than
rounding away scene differences. Matrix layout is row-major, units mm,
1–32 explicit instance entries; the affine final row is `[0,0,0,1]`.
`source_model_sha256` must match the model file hash in the manifest.
The scene file is a bounded, *self-reported* input witness: equality does
**not** verify that the native importer or WASM engine actually obeyed
these transformations. A separate exported-STL bounds audit and/or
independently observed rendered/deposited geometry is still required.
It also does not resolve the known full-native vs restricted-WASM preset
mismatch, 3MF-vs-STL import differences, or engine/provenance trust.

The existing synthetic manifest unit fixtures now declare and test
matching placement, shifted placement, missing scene, tampered source,
invalid affine matrices, and malformed IDs. This closes a logical
loophole in strict input identity; it is **not** a new real same-profile
G-code result. No production WASM, third-party data, or public Pages
artifacts are changed.

## 2026-11-18: independent native placed-triangle audit

The official v2.5.0 native CLI's shared 20 mm cube test now also runs
`scripts/audit_native_parity_cube_geometry.py` **after** exporting the
positioned Core 3MF to STL with `--arrange 0`. It reads the original 684-byte
SHA256-pinned STL independently, applies the fixed (128,128,0) source-to-bed
translation to every triangle, then compares the native export's 12 placed
triangles. Face order, vertex order and winding may differ, but changing
triangle connectivity fails even when the XYZ bounding box remains identical.

The export audit rejects changed source bytes, multiple/missing STL exports,
non-finite coordinates, inconsistent triangle counts, out-of-bounds
translations, and excessive per-vertex deviations (>0.001 mm). The audit
emits numeric JSON only, and is included in the native CLI workflow before
native slicing; its unit tests are also run by the lightweight parity CI.
This is stronger placement evidence than comparing only the outer bounds,
but **only for the native exporter**. It neither proves the browser WASM
has applied its declared transform nor validates settings, G-code equality,
3MF round-trip semantics, runtime provenance or print safety. The real
native/WASM equal-full-profile G-code comparison remains blocked.

## 2026-11-18: independent WASM deposited-path placement witness (opt-in CI)

The isolated Chrome/WASM cube test now audits **actual positive-E XY G-code
segments** using `scripts/audit-wasm-cube-deposition.mjs`, rather than
assuming that the declared `(128,128,0)` project matrix was obeyed.
The test fixture is the byte-pinned 20 mm cube (12 triangles), and its
independently verified native 3MF export occupies [128,148] mm in X/Y and
[0,20] mm in Z. WASM deposition must contain at least 50 positive-E XY
segments, at least 85% within a one-millimeter-expanded XYZ cube envelope,
an XY span of at least 18.5 mm, near-bottom and near-top Z layers, and no
silently skipped malformed motions/arcs in the bounded read-only parser.
The audit records numeric bounds, counts and the fraction inside. It
allows a small outside priming path without treating travel as deposited
material. Unit tests reject shifted outputs, sparse corner imitations and
predominantly outside deposition.

This is **G-code path location evidence**, not an exported WASM mesh face
audit: a different mesh could produce similar toolpath extents. The nominal
and printer-dependent wall offsets, skirts/brims and per-layer behavior can
change the values; a failed gate requires inspecting the real isolated
Chrome output, not broadening thresholds to force PASS. Its
`parity_pass` remains false regardless of whether the placement gate
passes. The G-code still uses the restricted WASM development profile and
the native CLI still loads full official presets and imports a Core 3MF
wrapper. No same-input full-profile native-vs-WASM G-code equivalence or
physical print readiness is asserted. Artifacts remain CI-only.

## 2026-11-18: explicit single-slot filament flow variant guard

The restricted localhost profile resolver now distinguishes a **single
filament_max_volumetric_speed value with no requested variant** (retained as a
bounded generic one-slot setting) from an **explicitly requested extruder
variant**. Previously the latter bypassed the variant-name lookup when the
speed array had length one: a different or unlisted variant could appear to
be selected while receiving an unrelated limit. Explicit selection now
requires a one-element native filament_extruder_variant array with an exact
matching name, bounded selected flow rate, and reported index 0. Missing,
mismatched, malformed or multi-value metadata fails closed. Existing pinned
six-slot Generic PLA selection remains unchanged. Local Node regression tests
exercise the one-slot and six-slot paths; a passing test does not establish
native-vs-WASM parity or safe machine operation.

## 2026-11-18: explain native/restricted option-value shapes, not just key gaps

The pinned-profile coverage audit (`scripts/audit-native-wasm-profile-gap.mjs`)
now emits a read-only `raw_value_difference_shapes` table for overlapping
machine, process and filament option keys. It reports the source/restricted
JSON value shapes and a conservative `syntax_only_hint` without copying
potentially executable G-code, original values or full licensed profiles
into the summary. Four source-checked local-adapter representations are
recognized: a single-nozzle `nozzle_diameter` vector becoming a scalar,
and `sparse_infill_density`'s decimal percent token becoming a bare numeric
percentage. Two additional source-checked one-slot filament conversions
are recognized: `filament_type` (only `["PLA"]` to `"PLA"`) and
`nozzle_temperature` (one bounded numeric nozzle temperature to a scalar).
These keys **remain** in the raw differences list.

Every other unequal JSON value is explicitly `unexplained`, including
multi-nozzle arrays, percent-relative speed settings and unapproved
filament-vector reductions. The per-family and aggregate counts
`recognized_syntax_only_count` and
`unexplained_raw_value_difference_count` separate follow-up work from
known local syntax conversions; they are *not* a claim of equivalent
PrintConfig semantics or verified application by the browser engine.
Synthetic regression tests reject over-broad conversions, and the
source-pinned CI runs the audit on real v2.5.0 fixture records. Option-key
gaps, full-preset forwarding, native-vs-WASM G-code parity and physical
printer behavior remain unresolved; nothing is enabled on public Pages.

On the pinned Creality CR-10 / Generic PLA diagnostic, the updated gate
reports 109 machine, 212 process and 68 filament native keys absent from the
restricted bridge. The four same-key raw differences are all accounted for
by the four documented *syntax* conversions. This leaves zero **unclassified
raw value shapes among overlapping keys**, but the 389 non-forwarded native
keys remain and real native/WASM effective configuration and G-code equivalence
are **not** established. These counts describe one selected profile chain,
not all OrcaSlicer printers or an available production feature.

## 2026-11-19: padded extruder-mode tokens in parity fixture gate

The read-only `compare_gcode.py` extrusion-count and positive-E length gates
now interpret zero-padded `M082` as absolute E and `M083` as relative E,
matching the respective `M82` and `M83` mode meanings. Previously, the
`M083` spelling incorrectly entered the *absolute* branch while `M082`
was not recognized, which could count phantom extrusion after a retraction
or miss real relative-E extrusion. These modes are used **only** for fixture
deposition metrics: strict ordered G-code comparison still distinguishes
differently spelled commands. Offline regressions cover the false counts.

This correction improves the credibility of the minimum-extrusion gate and
numeric diagnostic. It does **not** resolve native/full-profile versus
restricted-WASM inputs, printer-specific modal rules, or toolpath parity.

## 2026-11-19: read-only constant-Z deposition strata

The strict ordered native/WASM G-code comparator now reports two additional
**diagnostic-only** summaries per side: the number of distinct Z positions
with counted positive-E XY motion at a constant height, and the count of
positive-E XY moves that also change Z (nonplanar moves). A bounded list of
up to 15 differing Z positions contains the two sides' per-position move
counts. Position handling includes explicit G0/G1 Z motion, G90/G91, G92 Z
resets and G20/G21 units; accepted G17 arcs can contribute when their Z is
constant. This deliberately does **not** infer full slicer layer identity,
extrusion width, material volume, or print correctness from endpoint Z alone.

Malformed stateful geometry still invalidates the metric (null diagnostics)
instead of creating a false layer. Numeric Z differences are reported as
observed without merging levels using an arbitrary tolerance. Strict command
matching, both producers' input requirements and the requirement that
unequal full profiles **fail parity** remain unchanged. Tests cover Z ramps,
relative moves, G92, inch units, arcs, height disagreements, and malformed
geometry. This is useful for diagnosing eventual real-engine differences;
**no equal-full-profile native/WASM G-code match is claimed**.

## 2026-11-19: real-engine deposited Z-strata diagnostic

The existing historical real-G-code native/WASM cube pair can now surface the
read-only per-Z deposition counters added to the strict comparator. In
`scripts/diagnose_live_cube_pair.py`, the `metrics` object includes native
and WASM counts of constant-Z positive-E XY strata, nonplanar positive-E XY
moves, and a bounded list (at most 15) of the first Z positions whose move
counts differ. The numbers come from the **actual G-code bytes** supplied to
that diagnostic, not from declared preview settings or test fixture labels.
Malformed/unsupported stateful commands can yield null diagnostics instead
of fabricated planar levels. This deliberately excludes raw toolpath commands,
first command differences, full licensed profiles and print-ready G-code
from the archived numeric-only report. Regression cases cover unchanged
planar counts, a shifted deposition height with unchanged total extrusion
moves, and a nonplanar XY/Z extrusion not counted as a planar move.

The real-engine workflow still uses a historical WASM Chrome artifact,
which may expire; if unavailable, that optional pairing is skipped. The
native input is a placed Core 3MF wrapper with full v2.5.0 source-pinned
presets; WASM uses source STL and a restricted generic-PLA profile. Even
when both outputs are present and analyzed, the report **always** says
`parity_pass: false`. These diagnostics cannot demonstrate equal effective
profiles, complete layer topology, engine identity, full G-code parity, or
physical print safety. The production Pages site and headless WASM candidate
are not modified by this diagnostic-only change.


## 2026-11-19: distinguish absent Z planes from differing move counts

The real native/WASM G-code comparison now reports *all* exact, counted
constant-Z deposition heights present on only one side as numeric membership
counts, plus at most 15 sorted decimal heights per direction. These new
`native_only_counted_planar_z_levels` and
`wasm_only_counted_planar_z_levels` counters complement the existing
`first_counted_planar_z_differences` field, which also contains shared
heights with unequal positive-E move counts. The full membership counts
are **not** truncated to the first 15 example heights. Malformed modal
geometry yields null values rather than fabricated heights. This diagnostic
does not merge near-equal Z values, infer true layer identity or archive
executable G-code. Regression tests cover equal sets, shifts, more than
15 unmatched heights and invalid motion.

The preceding real-engine [native CLI probe #44368290038](https://github.com/temesotejam/layer-workbench/actions/runs/44368290038)
passed on 2026-11-18 UTC and yielded 101 native versus 100 historical
WASM constant-Z deposited heights. Its bounded numeric differences include
a native-only deposited height at **0.28 mm** (two counted moves).
The G-code had 3,896 native and 3,492 WASM counted positive-E movements.
These are **not** same-effective-profile G-code results: the native side
used full source-pinned v2.5.0 presets and Core 3MF while WASM used a
restricted development profile and STL, and the browser fixture is
historical. They cannot establish the cause of the extra height,
equivalent slicing, or printer safety. Rerunning the diagnostic on the
same historical pair remains explicitly opt-in and `parity_pass: false`.

## 2026-11-19: fail closed on impossible G17 arcs and unknown deposition

The fixture comparator now rejects an impossible G17 XY arc (missing
center/radius, invalid radius or inconsistent endpoints) **even if it has
no positive E**. Previously the validator skipped that arc while allowing
its changed coordinate state to influence subsequent G1 deposition, so
an identical invalid native/WASM pair with enough surrounding extrusion
could erroneously satisfy the minimum-deposition gate. Invalid stateful
motion also blocks strict fixture matching when the optional minimum is
zero: unknown metrics can no longer masquerade as zero deposition.

This is a conservative **read-only fixture and diagnostic correctness**
change. It does not extend G18/G19 arc support, normalize firmware-specific
dialects, prove official profile equivalence or make any generated G-code
print-safe. The native/WASM full-profile mismatch remains a release blocker.

## 2026-11-19: numeric deposition footprints for one-sided Z planes

The real native/WASM cube diagnostic now includes up to 15 per-direction
**read-only G1 deposition footprints** for Z positions observed only on one
side. For each height it reports positive-E planar move count, counted G1
line versus G17-arc moves, G1 XY path length (mm), G1 positive-E command
length (mm), and min/max X/Y of the **G1 endpoints**. Full-circle or curved
G17 segments count as arcs but their length/interior extrema are deliberately
excluded rather than guessed. A plane consisting only of arcs has null G1
endpoint bounds. Malformed modal geometry gives null footprints and a
failed input gate; it never produces inferred valid toolpaths.

This specifically helps investigate the previously observed native-only
Z=0.28 mm two-move stratum: its actual footprint may distinguish a tiny
start/prime segment from an object-scale feature, but no feature identity
or cause is inferred from bounds alone. The numeric-only report excludes
raw G-code, comments, filenames and full licensed profiles. Full native and
restricted WASM profiles and import paths still differ: every real diagnostic
remains `DIAGNOSTIC_ONLY` with `parity_pass: false`, and no WASM deployment
or physical print-safety assertion is made.

## 2026-11-19: native-only 0.28 mm strata explained by pinned startup G-code

The live official-native CLI and historical browser-WASM diagnostic in
[PR #97](https://github.com/temesotejam/layer-workbench/pull/97) found one
native-only constant-Z deposition height at **0.28 mm**, with exactly two
straight G1 positive-E moves, **250 mm** combined XY line length, **30 mm**
commanded positive E and endpoints within **X=10.1–10.4 mm,
Y=20–145 mm**. These G1 paths are well outside the shared cube's
X=128–148 mm object bounds.

Independently, the official upstream-pinned
[Creality CR-10 0.4 nozzle profile](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/resources/profiles/Creality/machine/Creality%20CR-10%200.4%20nozzle.json)
specifies exactly two **125 mm** introduction/priming lines at those
coordinates and Z=0.28 mm, with cumulative E commands 15 and 30. The
source-pinned CI assertion now verifies those four startup-position/motion
commands and that `machine_start_gcode` remains excluded from the
restricted browser adapter. This accounts for **the native-only 0.28 mm
deposition stratum**; it is **not** evidence of a difference in the
slicer's object first-layer height (the process setting is 0.2 mm).

This does **not** explain or correct the remaining hundreds of differing
positive-E moves, other per-Z discrepancies, full-profile mismatch or
native Core 3MF versus WASM STL import. It does not authorize executing
machine startup G-code in a browser, deploying WASM to Pages or printing
the unvalidated output. The diagnostic remains `parity_pass: false`.

## 2026-11-19: compare G1 footprints at Z heights present on BOTH sides

The numeric-only native/WASM cube diagnostic previously reported planar
positive-E move-count differences and G1 endpoint footprints only for Z
positions **missing from one side**. It could not show a change in XY
path length, G1-positive E or XY bounds when both outputs deposited at
the same exact Z with the same move count.

The comparator now counts **all** shared deposited Z positions with
different numeric G1 footprints and includes at most 15 sorted samples in
`first_shared_counted_planar_z_footprint_differences`. Each sample has the
exact Z, the native and WASM numeric footprints (move counts, G1 lengths,
positive E, endpoint bounds and G17-arc counts), plus WASM-minus-native G1
length and positive-E differences. Differences in XY distance are rounded
to 0.000001 mm for diagnostic display, not as toolpath equivalence; bounds
and filament E remain exact decimal observations. The separate full
`shared_counted_planar_z_footprint_difference_count` is not truncated.

This is useful for separating the *known* native-only Z=0.28 mm startup
prime paths from additional differences at Z values **shared** with WASM.
The analysis does **not** remove, rewrite or label startup G-code or
subtract any path from the strict ordered comparison. It never assumes
a feature is an object wall, infill or priming command. Curved G17
path lengths and arc interior extents remain omitted, nonplanar moves are
not included, and malformed stateful geometry fails closed with null
footprint results. It archives only numeric summaries, not executable
toolpaths or original licensed profiles.

The two real engines still differ in their effective machine/filament/
process presets and native Core 3MF versus browser STL import path.
Therefore every real comparison stays `DIAGNOSTIC_ONLY` with
`parity_pass: false`; no real print-safety or G-code equivalence is implied.
