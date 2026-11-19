# OrcaSlicer v2.5.0 top/bottom surface patterns — restricted localhost acceptance

Source pin: OrcaSlicer v2.5.0 `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, official `resources/profiles/Creality/process/fdm_process_common.json`, `resources/profiles/Creality/process/fdm_process_creality_common.json`, and `resources/profiles/Creality/process/0.20mm Standard @Creality CR-10 0.4 nozzle.json`.

These are **distinct** native process keys, not synonyms for `internal_solid_infill_pattern` or `sparse_infill_pattern`:

| Native process key | fdm common | Creality common | CR-10 child | Effective |
| --- | --- | --- | --- | --- |
| `top_surface_pattern` | *not set* | `monotonicline` | `monotonic` | `monotonic` |
| `bottom_surface_pattern` | *not set* | `monotonic` | `monotonic` | `monotonic` |

The explicit localhost-only profile resolver and process override parser now retain two independent values, with only three source-known tokens: `monotonic`, `monotonicline`, `rectilinear`. Everything else, including UI labels, arrays, objects and unknown patterns, fails closed. The pinned profile CI tests **actual fetched upstream JSON files**, not bundled copies. These settings are forwarded as-is to the existing opt-in isolated Chrome WASM test bridge. No default is invented if a profile omits either key.

The isolated Chrome acceptance test uses the fixed generic PLA development fixture and the same two STL objects to confirm each pinned CR-10 surface token is accepted by the real WASM slicer with positive-E XY deposition. This alone does **not** show that changing either pattern alters its own outer-skin path; a controlled A/B comparison restricted to feature-tagged top- and bottom-surface deposited strokes is the next gate. There is also no equivalent full-profile native-vs-WASM G-code comparison. Unsupported official machine/process/filament settings still make the overall full-profile parity gate fail.

This change does not modify the public Pages deployment, enable user-provided executable G-code, redistribute vendor assets or certify any G-code for physical printing.

## 2026-11-19: exact-tagged outer-skin path A/B diagnostic

`scripts/surface-skin-diagnostic.mjs` compares **actual parsed planar, positive-E XY** strokes for exactly `top surface` and `bottom surface` feature tags. It separately reports unordered geometry differences and ordered/directional stroke sequence differences by observed Z height, and bounded XY path length and commanded filament-axis E length. Untagged, unrelated internal-solid/infill/wall paths, header/config hashes, travel moves, omitted arcs and malformed motion cannot become evidence of skin behavior. The unit test includes adversarial impostor labels and an order-only negative control for geometric change.

The isolated Chrome acceptance now A/B-slices the unchanged two-STL development fixture, varying only one native pattern key between `monotonic` and `rectilinear`, returning the other key to its previous state before starting the next comparison. It writes bounded JSON summaries `parity-output/top-surface-pattern-deposition.json` and `parity-output/bottom-surface-pattern-deposition.json`. An `observed_...` result means only a tagged path signature changed in this fixture. If no tagged surface strokes exist on either side, or no difference is measured, the result is explicitly `inconclusive_...`; CI does not relabel that result as pattern-path proof.

This is a localhost test using generic PLA and a partial profile. Differences in G-code stroke ordering or path geometry do not establish physical surface quality, native full-profile parity, or print safety. A same-full-profile native CLI comparison is still needed; public Pages remains unchanged.

### Real isolated Chrome measurement (PR #113)

[Initial diagnostic CI #44539991995](https://github.com/temesotejam/layer-workbench/actions/runs/44539991995) **PASS**. On an unchanged two-cube development plate, `monotonic` → `rectilinear` changed the **unordered, 0.001 mm-rounded, exact-feature XY stroke geometry signature**, even though total path length/E can remain identical:

| Only changed key | Tagged Z | Monotonic strokes | Rectilinear strokes | XY path length, both | Positive commanded E, both |
| --- | ---: | ---: | ---: | ---: | ---: |
| `top_surface_pattern` | 20.04 mm | 265 | 265 | 1718.82728 mm | 42.06131 mm |
| `bottom_surface_pattern` | 0.20 mm | 239 | 237 | 1547.50711 mm | 52.84719 mm |

Since actual **tagged geometry differences** were observed independently for both roles, the pinned fixture CI was tightened to require `observed_tagged_skin_geometry_difference` for each. The comparator itself still reports inconclusive evidence when supplied missing or identical tagged paths. These measures do **not** demonstrate any improvement in printed surface texture, equivalent native toolpaths, machine calibration, or print safety.
