# Official v2.5.0 native CLI bootstrap (diagnostic only)

The workflow [`probe-native-v250-cli.yml`](../.github/workflows/probe-native-v250-cli.yml)
downloads the **official** Ubuntu 24.04 x86_64 AppImage from the fixed
`OrcaSlicer/OrcaSlicer` **v2.5.0 release** into a disposable GitHub Actions
runner. It checks the observed release-asset SHA-256 against the exact value
`d13eb0a9cd618ed080ab6b82c64c0a60c4501aac91e88d5ac2c3b526fb141a7c`
(observed on two earlier PR CI downloads), and records the AppImage format
to short-lived CI logs, never commits or republishes the binary.

Its initial bootstrap tests two bounded CLI operations:

1. `--help` (native CLI starts without invoking the GUI workflow).
2. `<independently-generated two-build-item Core 3MF> --info`, using
   `scripts/make_3mf_two_build_fixture.py` (read-only model inspection).

The AppImage runs with `APPIMAGE_EXTRACT_AND_RUN=1` to avoid requiring
FUSE on the runner. A nonzero return code, empty output or timeout causes
CI to **FAIL**. The fixture is a synthetic 3MF Core file, not a desktop
OrcaSlicer project. No real printer settings, serial or network connection,
slicing, G-code export, printing, or public browser deployment is involved.

## Acceptance and limits

A successful CI run would establish only that the official packaged Linux
v2.5.0 CLI executable starts in the runner and accepts this one independent
Core 3MF for an `--info` operation. The release URL is fixed by tag and file
name, but the downloaded SHA-256 is recorded *after* download; this is **not**
a separately trusted pre-pinned binary digest. Do not infer that the packaged
binary exactly corresponds to the upstream source commit solely from this
check.

This does **not** verify object hierarchy import/export preservation,
Orca preset compatibility, a full native `PrintConfig`, native G-code generation,
desktop GUI operation, or WASM parity. It produces **no print-ready output**.

## Next gated step

Use the same byte-identical STL, source-pinned **resolved full** machine,
filament and process settings, and explicit CLI options to generate a first
official-native v2.5.0 G-code fixture. Capture its release-asset digest, output
digest and exact invocation. Only then generate a paired WASM fixture and run
`scripts/check_parity_pair.py`, disclosing all unsupported settings and
gating on genuine positive-extrusion toolpaths. Do not label the native/WASM
outputs identical until the actual pair comparison passes.


## 2026-11-16: official-native synthetic Core 3MF export geometry gate

The CI also invokes the *same official SHA-verified native binary* with
`--arrange 0 --export-stl --outputdir ...`, then checks the exported STL
triangles against both explicitly positioned 20 mm Core 3MF build items
(90..110 / 150..170 mm X, 90..110 mm Y, 0..20 mm Z). The checker accepts
either one combined STL or two per-object STLs, requires exactly 24
nondegenerate triangles, exact separated world-space bounding boxes,
and 12 faces per cube. Synthetic binary/ASCII STL regressions ensure
missing items and changed placements fail.

**Important discovery:** the initial native CLI export *without*
`--arrange 0` did not preserve the input build positions: it emitted
two individual STLs with bounds X=90..110 and Y=79..99 / 101..121 mm,
rather than the source's X=90..110 / 150..170 mm and Y=90..110 mm.
See [initial failure #43779091892](https://github.com/temesotejam/layer-workbench/actions/runs/43779091892).
This is consistent with automatic object arrangement in the CLI, not
evidence of a native 3MF import error. Consequently, future paired
native/WASM comparisons must set and record the CLI arrangement mode;
otherwise the tools may compare **different placements** and produce
misleading G-code mismatches.

A successful gate tests a **single independent two-cube synthetic Core 3MF
fixture**. It is not a general desktop-native 3MF round-trip test, full
settings/geometry compatibility test, G-code equivalence test or
print-safety certificate. Text logs and SHA-256 digests are archived, but
the official binary and exported meshes are not published.


The corrected opt-out **PASSed** in [native export geometry CI #43779208648](https://github.com/temesotejam/layer-workbench/actions/runs/43779208648): two individual STLs with 12 triangles each; X=90..110 and X=150..170, both Y=90..110 and Z=0..20 mm. This explicitly verifies native export placement for the fixture with auto-arrange disabled, and shows why comparing default-arranged output would be misleading.

## 2026-11-16: first official-native v2.5.0 G-code with source-pinned full JSON

The [native CLI PR #34](https://github.com/temesotejam/layer-workbench/pull/34) adds `scripts/prepare-native-v250-presets.mjs` and the first **actual native headless slice** in the disposable Linux CI runner. The importer uses the existing source-preserving full inheritance resolver for exact, pinned v2.5.0 upstream JSON (commit `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`), with these explicitly named selections: Creality CR-10 0.4 nozzle machine, 0.20mm Standard @Creality CR-10 0.4 nozzle process, and OrcaFilamentLibrary Generic PLA @System. No upstream profile JSON is checked into this repository or deployed.

The CI prepares full flat records with **111 machine keys, 240 process keys, and 73 filament keys** (including `type` and `name`), keeps vectors intact, and records exact preset/asset SHA-256 hashes. It invokes the SHA-pinned official Ubuntu 24.04 AppImage with `--load-settings`, `--load-filaments`, `--arrange 0`, `--slice 0`, and the same independently generated two-cube Core 3MF. The real [Chrome-independent native workflow run #43782297548](https://github.com/temesotejam/layer-workbench/actions/runs/43782297548) **PASSed**. One `plate_1.gcode` was produced (SHA-256 `4d472e43cfd84f6661c5d37161e3dda9fe52ac457c2285193d6a0abf2e3854f6`), with **14,059 parsed commands, 13,771 G0/G1/G2/G3 moves, and 7,722 conservatively counted positive-E XY moves**. It requires at least 100 actual extrusion moves rather than accepting an empty G-code or a successful exit alone.

**Proof limit:** the native executable *accepted the full resolved input files* and returned nonempty G-code; this does not mean every one of the upstream keys was applied as expected. The selected Generic PLA has multivariant values that require explicit semantic reconciliation before any machine-use claim. This run does **not** independently measure final feature speeds, dimensions or temperature/application equivalence, nor compare WASM output with the exact same input files. The CI stores only diagnostic logs and digests; neither resulting G-code nor licensed profile JSON is redistributed or deployed. Never print from this test output. The next gates are effective-config/feature application audit, exact-input WASM fixture generation and numerical path comparison.


## 2026-11-16: native process layer-height effective-settings probe

The native CLI integration workflow now includes an explicit **one-setting perturbation test**.
It first slices the same two-object, arranged-off Core 3MF with the exact
source-pinned full Creality CR-10 / Generic PLA profile (process layer_height
0.20 mm). It then privately clones only the resolved process JSON, changes
layer_height to 0.25 mm, and slices the same fixture again with the same
official AppImage, machine/filament JSON, and CLI flags. These experimental
outputs remain inside ephemeral CI runner directories.

The independent scripts/verify_native_layer_height.py counts **distinct Z
levels on real positive-E XY extrusion moves**, tracks absolute/relative XYZ,
M82/M83, G92, and units, and checks that the median Z-layer step shifts from
approximately 0.20 to 0.25 mm while the number of deposited layers decreases.
Unchanged G-code, missing extrusion, insufficient print height or ambiguous
motion words cause failure. Offline synthetic regression tests cover modal
extrusion, Z-only priming, failure on unchanged settings, and ambiguous words.

This tests observable native **process option application** for one synthetic
fixture; it does not certify all upstream keys, full vendor semantics, native
3MF parity, WASM capability, native-vs-WASM G-code equality, or printer safety.
Only hash manifests and textual diagnostics are archived; no generated G-code
or licensed upstream profiles are redistributed.


## 2026-11-16: initial nozzle heater target application probe

The native CLI CI now makes one **ephemeral change** to the same pinned,
fully inherited Generic PLA @System filament JSON: the single-element
nozzle_temperature_initial_layer array changes from ["220"] to ["235"]
degrees C. The source profile, ordinary nozzle_temperature, process profile,
machine profile, 3MF input and --arrange 0 are unchanged. The new
scripts/verify_native_nozzle_temperature.py reads **actual G-code** and requires
the first positive M104 S (set nozzle) and M109 S (wait nozzle) targets to change
from 220 to 235. It ignores comments, handles line numbers and decimal target
notation, and fails closed on ambiguous heater words, missing targets or
unchanged heater instructions. Offline regression cases cover each gate.

This is a narrow **native effective-command test**, not a guarantee that
every temperature option was applied, not a measurement of thermistor
temperature, and not WASM parity. The selected preset's normal later-layer
temperature is deliberately **not changed**; comparing all nonzero heater
commands as if they were identical would be an incorrect acceptance test.
The diagnostic G-code, upstream JSON and official AppImage remain ephemeral.
Only textual audit logs and file digests may be uploaded. Never print from
these fixtures or enable the unverified engine on the public site.


## 2026-11-16: source-pinned native outer-wall speed applied to actual extrusion commands

[PR #37](https://github.com/temesotejam/layer-workbench/pull/37)
adds a third **effective native setting** test to the same official v2.5.0
AppImage and independently generated two-item Core 3MF. The pinned,
fully inherited CR-10 process option `outer_wall_speed` is **25 mm/s**.
The CI clones that private process JSON, changes only this value to
**2 mm/s**, and invokes the same native CLI with the same machine,
filament, object placements and flags.

The independent `scripts/verify_native_outer_wall_speed.py` reads real
G-code, tracks modal XYZ/E/units/feedrate, and attributes only **positive-E
XY G1 extrusion** under explicit `;TYPE:` / `;FEATURE:` outer-wall tags.
Travel moves, isolated E priming, free-text comments and malformed
feature directives cannot satisfy the acceptance gate. Ambiguous
motion words fail closed. Regression tests cover both positive and
negative cases.

In the [first PR native run #43803096242](https://github.com/temesotejam/layer-workbench/actions/runs/43803096242),
**PASS**: both outputs had **800** tagged positive XY outer-wall moves.
Median commanded outer-wall speed changed from **F1500 mm/min
(25 mm/s)** to **F120 mm/min (2 mm/s)**. This confirms the process option
affects native generated path commands for this fixture; it does **not**
measure physical carriage velocity, demonstrate all machine/profile
settings, compare native vs WASM, establish complete OrcaSlicer parity,
or approve printing. Only text logs and hashes are retained; the
temporary generated G-code and source-pinned upstream profile files are
not deployed or published.

Next: build a true same-bytes, same-effective-profile native/WASM G-code
pair and report numerical toolpath differences, including any unsupported
WASM profile options; do not claim parity until that comparison exists.

## 2026-11-16: ordered-command repeatability gate before native/WASM pairing

A reproducibility prerequisite now re-runs the **same** pinned official-native
v2.5.0 AppImage on the same Core 3MF, full flattened machine/process/filament
JSON, `--arrange 0` mode, and CLI flags **inside one CI runner**. The
`scripts/verify_native_gcode_repeatability.py` audit requires at least 100
conservatively counted positive-E XY deposition moves in each run, a bounded
G-code size, and an exact sequence of canonical G/M/T commands. It records
both raw SHA-256 digests, both ordered-command SHA-256 fingerprints, command
counts and up to 15 actual command differences when any exist.

The canonical comparison omits comments/blank lines and normalizes numeric
formatting, but it **does not** sort commands, drop printer commands or
silently tolerate toolpath changes. A byte-level hash mismatch with matching
ordered commands can be reported without falsely asserting different toolpaths.
A mismatching command sequence or travel-only output fails the acceptance gate.
Regression tests cover raw metadata drift, numeric/toolpath differences,
missing deposition, invalid sizes, and nonzero CLI exit status.

This only establishes *official-native repeatability for one synthetic
fixture*. It neither proves that the resolved upstream settings fully applied,
nor verifies WASM profile equivalence, native/WASM G-code parity or machine
safety. Generated G-code and upstream JSON are kept inside disposable CI;
only textual fingerprints, hashes and audit diagnostics are archived.
**Next:** emit the same fixture bytes and *same effective complete settings*
through the WASM engine and run the existing strict `check_parity_pair.py`
gate before making any matching-toolpath claim.

## 2026-11-16: strict XY bridge subtype accounting for native/WASM preflight

The native bridge-speed audit now records **per-label positive-E XY G1 counts**
for the six explicitly accepted bridge labels, using the same normalized names
as the isolated-browser bridge-speed audit. The browser diagnostic additionally
requires actual XY displacement on positive-extrusion preview segments, so a
vertical extrusion or extrusion-only prime cannot masquerade as F120 bridge
deposition. Negative fixture tests reject invalid labels and missing XY motion.

This improves feature attribution before a real desktop-versus-WASM comparison.
**It is not a parity result**: the browser parser may tessellate G17 arcs,
whereas the native count covers G1 only; native processing uses pinned
full printer/filament/process presets and an explicit Core 3MF placement,
while the browser arch probe uses restricted diagnostic settings. The inputs
and complete ordered G-code have not been proven identical. G-code remains
test-only and must not be printed.
