# Official v2.5.0 native CLI bootstrap (diagnostic only)

The workflow [`probe-native-v250-cli.yml`](../.github/workflows/probe-native-v250-cli.yml)
downloads the **official** Ubuntu 24.04 x86_64 AppImage from the fixed
`OrcaSlicer/OrcaSlicer` **v2.5.0 release** into a disposable GitHub Actions
runner. It records the observed release-asset SHA-256 and the AppImage format
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
