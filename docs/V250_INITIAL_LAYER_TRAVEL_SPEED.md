# OrcaSlicer v2.5.0 relative first-layer travel speed (local WASM diagnostic)

Pinned source: [OrcaSlicer v2.5.0 CR-10 process](https://github.com/OrcaSlicer/OrcaSlicer/tree/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/resources/profiles/Creality/process). The selected `0.20mm Standard @Creality CR-10 0.4 nozzle` chain includes `initial_layer_travel_speed: "50%"`. This is a native float-or-percent setting; **50% is relative to `travel_speed`, not 50 mm/s**. See also the [OrcaSlicer initial-layer travel wiki](https://www.orcaslicer.com/wiki/speed_settings_initial_layer_speed/).

The restricted localhost process bridge now preserves a single-slot `initial_layer_travel_speed` as an exact percentage token (1–200%) or an explicitly bounded absolute scalar (1–1500 mm/s). It rejects ambiguous, non-finite, vector, multi-nozzle and malformed values. No assumption is made about device firmware or actual machine speed. Real pinned upstream profile files remain fetched only in CI.

Tests: `scripts/test-process-profile-unit.mjs` checks parsing; `scripts/test-orca-profile-collection.mjs` checks inherited percent semantics; `scripts/test-upstream-v250-creality.mjs` checks the pinned real chain; `scripts/test-engine-probe.mjs` attempts actual isolated Chrome/WASM acceptance. These are **not** native-vs-WASM G-code parity checks; measured first-layer travel feedrates and same-full-profile identity are still open. No new production Pages functionality or print-safety approval is implied.

## First-layer commanded travel feedrate A/B gate (2026-11-20)

The isolated Chrome probe A/B-slices the same two synthetic STLs with
travel_speed=80 mm/s and initial_layer_print_height=0.2 mm held fixed,
changing only initial_layer_travel_speed from 50% to 100%. The parser
selects the first positive-E planar XY deposition layer and compares modal
F on non-depositing planar XY moves with identical start/end geometry.
It rejects skipped arcs, malformed motion and missing F and requires
unchanged deposited geometry. The numeric paired F results are saved in
parity-output/first-layer-travel-feedrates.json (14-day CI artifact).

Unit tests exclude later-layer changes and altered first-layer geometry.
The real Chrome test fails if no first-layer travel F increase is measured.
This measures commanded speed response only, not desktop native parity,
physical print speed, a guaranteed 2:1 ratio on all travels or print safety.
