# OrcaSlicer v2.5.0 top/bottom surface patterns — restricted localhost acceptance

Source pin: OrcaSlicer v2.5.0 `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, official `resources/profiles/BBL/process/fdm_process_common.json`, `resources/profiles/Creality/process/fdm_process_creality_common.json`, and `resources/profiles/Creality/process/0.20mm Standard @Creality CR-10 0.4 nozzle.json`.

These are **distinct** native process keys, not synonyms for `internal_solid_infill_pattern` or `sparse_infill_pattern`:

| Native process key | fdm common | Creality common | CR-10 child | Effective |
| --- | --- | --- | --- | --- |
| `top_surface_pattern` | `monotonicline` | `monotonicline` | `monotonic` | `monotonic` |
| `bottom_surface_pattern` | `monotonic` | `monotonic` | `monotonic` | `monotonic` |

The explicit localhost-only profile resolver and process override parser now retain two independent values, with only three source-known tokens: `monotonic`, `monotonicline`, `rectilinear`. Everything else, including UI labels, arrays, objects and unknown patterns, fails closed. The pinned profile CI tests **actual fetched upstream JSON files**, not bundled copies. These settings are forwarded as-is to the existing opt-in isolated Chrome WASM test bridge. No default is invented if a profile omits either key.

The isolated Chrome acceptance test uses the fixed generic PLA development fixture and the same two STL objects to confirm each pinned CR-10 surface token is accepted by the real WASM slicer with positive-E XY deposition. This alone does **not** show that changing either pattern alters its own outer-skin path; a controlled A/B comparison restricted to feature-tagged top- and bottom-surface deposited strokes is the next gate. There is also no equivalent full-profile native-vs-WASM G-code comparison. Unsupported official machine/process/filament settings still make the overall full-profile parity gate fail.

This change does not modify the public Pages deployment, enable user-provided executable G-code, redistribute vendor assets or certify any G-code for physical printing.
