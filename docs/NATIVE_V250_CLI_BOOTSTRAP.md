# Official v2.5.0 native CLI bootstrap (diagnostic only)

The workflow [`probe-native-v250-cli.yml`](../.github/workflows/probe-native-v250-cli.yml)
downloads the **official** Ubuntu 24.04 x86_64 AppImage from the fixed
`OrcaSlicer/OrcaSlicer` **v2.5.0 release** into a disposable GitHub Actions
runner. It checks the observed release-asset SHA-256 against the exact value
`d13eb0a9cd618ed080ab6b82c64c0a60c4501aac91e88d5ac2c3b526fb141a7c`
(observed on two earlier PR CI downloads), and records the AppImage format
to short-lived CI logs, never commits or republishes the binary.

It attempts two deliberately bounded CLI operations:

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
