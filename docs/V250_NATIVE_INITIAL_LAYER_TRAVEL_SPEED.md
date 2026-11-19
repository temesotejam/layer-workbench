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
It checks the deposited geometry remains identical, **all** qualifying
travels match on both sides, all modal F values are available, at least
one travel speeds up and at least one approximately doubles. Malformed
motion or skipped arcs fail closed. A shared-subset match is not enough
for this controlled experiment. The measured native F values are written
to a short-lived CI report; no raw licensed profiles, executable or
printer G-code are published.

This confirms only a native **commanded** first-layer travel speed effect.
It does not establish speed on a real printer, identical native/WASM
G-code, complete effective-profile parity, or a valid print job. The
native Core 3MF and restricted browser profile paths are still distinct.
See `docs/NATIVE_WASM_DIAGNOSTIC_PAIR.md` for the remaining true-parity
gates. The browser WASM engine stays off public Pages.
