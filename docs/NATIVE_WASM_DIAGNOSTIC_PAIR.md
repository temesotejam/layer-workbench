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
