# OrcaSlicer v2.5.0 vertical shell thickness — localhost-only diagnostic

Source revision: [OrcaSlicer v2.5.0 commit 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/PrintConfig.cpp).

The original `PrintConfig.cpp` defines `ensure_vertical_shell_thickness`
as a `coEnum` with four exact serialized strings:
`none`, `ensure_critical_only`, `ensure_moderate`, `ensure_all`.
The pinned **Creality CR-10 0.4 nozzle / 0.20mm Standard** child process
sets `ensure_all`; the selected two ancestors do not supply this key.

This configuration can introduce *additional internal solid infill* near
sloping walls, independent of `top_shell_layers`, `bottom_shell_layers`
and their thickness floors. Dropping the native key makes the observed
native-vs-WASM internal-solid-vs-internal-bridge mismatch inconclusive,
even when the visible shell counts have been copied.

The restricted localhost profile-family resolver and flat process override
parser now accept **only** these four source-verified wire strings.
Strings such as `All`, numeric `0/1`, unsupported labels, objects and arrays
are rejected; there is no fallback, aliasing or silent inference. A
three-level inheritance test checks child precedence and absence handling.
Official JSON is fetched by CI only, with no vendor profile redistribution.

The pinned real-profile CI verifies the official inherited value, and
the mocked `orca.native-json` test verifies exact transport alongside
shell layer counts. The isolated Chrome/WASM test confirms that
`ensure_all` is accepted in a real two-STL slice with deposited XY
positive-E motion. **This fixture has no controlled sloped-wall geometry,
so it does not establish any shell-path difference, native G-code equality
or correct structural behavior of the enum.** The next experiment should
use one sloped-wall STL and fixed full effective settings to contrast modes,
then rerun the per-feature exact-Z comparison at 0.8 and 19.2–19.6 mm.

Public Pages, published engine binaries, real machine settings, printers
and executable start/end G-code are unchanged. No output is certified for
physical printing. This is only a source-pinned test bridge, not OrcaSlicer
v2.5.0 feature or visual parity.
