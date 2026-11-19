# OrcaSlicer v2.5.0 shell thickness — restricted localhost parity gate

The official v2.5.0 Creality CR-10 0.4 mm / 0.20mm Standard process
from upstream pin `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`
sets `top_shell_layers=5`, `bottom_shell_layers=4`,
`top_shell_thickness=0.8` mm and `bottom_shell_thickness=0` mm.
The Creality common ancestor specifies the same thickness values.
The upstream OrcaSlicer configuration distinguishes the **minimum
solid shell thickness** (float, mm) from the number of layers (integer).
A thickness of 0 disables the minimum-thickness floor, **not** solid
layers or the corresponding surface.

This change routes only `top_shell_thickness` and
`bottom_shell_thickness` through the restricted process JSON and
vendor-profile inheritance readers. Values are explicit scalar floats
in `[0, 5]` mm; the upper limit is a conservative test boundary, not
a claimed native OrcaSlicer maximum. Relative percentages, multiple
extruder vectors, nonfinite numbers and malformed values are rejected.
The official profile records are downloaded for verification in CI;
upstream originals are not committed or distributed.

A Chrome/COOP+COEP integration probe sets both shell-layer counts to 1,
keeps infill density fixed and compares the **real positive-E XY
G-code deposition strokes** produced with a top thickness of 0 and
1.6 mm. Only a genuine deposited path difference qualifies as
behavioral evidence. This intentionally tests a sensitivity outside the
pinned CR-10 production recipe; it does not establish native G-code
equivalence or validate the specific 0.8 mm profile in a real printer.

The experiment is available only in the explicit opt-in localhost
WASM lab and continues to use the existing trusted pinned candidate
artifact. Public GitHub Pages does not load/execute WASM. No printer
startup scripts are applied and no generated G-code is approved for
physical printing.

**Remaining:** compare the exact same full official
machine+filament+process effective settings and source geometry between
desktop native OrcaSlicer 2.5.0 and the browser WASM path, with
quantitative breakdown by solid shell, sparse infill, skirt and Z layer.
