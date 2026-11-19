# Native OrcaSlicer v2.5.0 first-layer travel F diagnostic

The source-pinned CR-10 process resolves `initial_layer_travel_speed` to
`50%`. The isolated browser WASM A/B probe already showed a commanded
travel F response when changing 50% to 100%. This independent **native**
experiment uses the official v2.5.0 Linux AppImage, the same two-item Core
3MF and pinned complete machine/filament/process profiles; only
`initial_layer_travel_speed` is changed to `100%` in a private copy of
the resolved process JSON. The baseline is the already-produced native
G-code; the changed profile is sliced once more without auto-arrange.

`scripts/verify-native-initial-layer-travel.mjs` parses actual generated
G-code, locates the first positive-E planar deposition layer, and pairs
non-depositing planar XY moves by exact rounded start/end/Z geometry.
It checks the first-layer deposited geometry **and commanded positive-E amount**
remain identical (rounded to 5 decimal places per linear stroke), **all** qualifying
travels match on both sides, all modal F values are available, at least
one travel speeds up and at least one approximately doubles. Malformed
motion, invalid deposited E or skipped arcs fail closed. A shared-subset match is not enough
for this controlled experiment. The measured native F values are written
to a short-lived CI report; no raw licensed profiles, executable or
printer G-code are published.

The native CI path filters now include the shared comparator, its unit test
and the parser, so changes in those dependencies trigger the real native
probe rather than relying only on previous green results.

This confirms only a native **commanded** first-layer travel speed effect.
It does not establish speed on a real printer, identical native/WASM
G-code, complete effective-profile parity, or a valid print job. The
native Core 3MF and restricted browser profile paths are still distinct.
See `docs/NATIVE_WASM_DIAGNOSTIC_PAIR.md` for the remaining true-parity
gates. The browser WASM engine stays off public Pages.

## G2/G3 first-layer exclusion (2026-11-20)

The shared preview parser retains each segment's original `sourceMotion` (`G0`, `G1`, `G2` or `G3`). A bounded G2/G3 curve is tessellated for visualization, but the interpolated segments do **not** carry actual per-stroke extrusion commands. The first-layer F comparison therefore fails closed if a rendered arc (deposition **or** travel) appears on the measured first layer; otherwise equal-looking sampled chords or partial linear subsets could incorrectly pass a speed-only experiment. Later-layer arcs do not invalidate this first-layer-only witness. Regression fixtures cover G2 travel and G3 deposition. This is not arc extrusion simulation or a native/WASM same-profile comparison.
