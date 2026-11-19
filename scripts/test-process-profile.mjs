// Local test overrides for the pinned OrcaSlicer one-slicer-api.
// These are process overrides ONLY, not a complete machine/material preset.
// Native profile JSON uses flat scalar keys; do not silently accept unknown
// machine settings, inherited profile trees, or untrusted executable content.
const LIMITS = {
  layer_height: [0.06,0.4],
  // First-layer physical height in mm, NOT an inferred percentage of layer_height.
  initial_layer_print_height: [0.06,0.5],
  // Native process line_width in absolute mm only (not e.g. 105%).
  // Pinned CR-10 0.20mm Standard uses 0.42 mm.
  line_width: [0.1,2],
  // Pinned Creality process first-layer width: absolute mm only.
  // Do not infer it from common line_width or initial-layer height.
  initial_layer_line_width: [0.1,2],
  // Explicit outer-wall path width is independent of the general width.
  // Only bounded absolute mm, not percentages or multiple extruders.
  outer_wall_line_width: [0.1,2],
  // Independently preserve the source-pinned native inner-wall width.
  // Only bounded absolute mm; %, vectors and inferred defaults are excluded.
  inner_wall_line_width: [0.1,2],
  // Independently carry the native sparse-infill width in absolute mm only.
  // The pinned CR-10 0.20mm process uses 0.45 mm; no relative widths.
  // Independent absolute top-surface width for the localhost WASM proof.
  top_surface_line_width: [0.1,2],
  sparse_infill_line_width: [0.1,2],
  // Independently forward pinned CR-10 internal solid infill extrusion width.
  // Local diagnostic only: absolute mm, no percentage or nozzle vectors.
  internal_solid_infill_line_width: [0.1,2],
  // Source-pinned CR-10 0.20mm Standard uses skirt_loops=2. Integer loops
  // only; enabling a skirt here is a localhost diagnostic, not print approval.
  skirt_loops: [0,10],
  // OrcaSlicer v2.5.0 PrintConfig.cpp: skirt_distance is a coFloat
  // with range 0..60 mm, default 2 mm. Local diagnostic only.
  skirt_distance: [0,60],
  // Native coInt: number of skirt layers, NOT millimetres.
  // Local diagnostic only; zero/negative and fractional modes are not vetted.
  skirt_height: [1,20],
  // Native v2.5.0 coFloat skirt speed (mm/s): 0 means native fallback.
  // 300 is a conservative local test-only ceiling, not a machine limit.
  skirt_speed: [0,300],
  wall_loops: [1,8],
  sparse_infill_density: [0,100],
  // Pinned native v2.5.0 process angle in degrees, never % or vector.
  infill_direction: [0,360],
  top_shell_layers: [0,12],
  bottom_shell_layers: [0,12],
  // Native v2.5.0 coFloat minimum shell thickness in millimetres.
  // The pinned CR-10 child uses 0.8 mm top, 0 mm bottom (disabled).
  // 0..5 mm is a conservative LOCAL test bound, not the native maximum.
  top_shell_thickness: [0,5],
  bottom_shell_thickness: [0,5],
  // Absolute millimetres/second for localhost WASM tests only.
  // Percentages and vendor-specific relative speed modes remain unsupported.
  outer_wall_speed: [1,800],
  inner_wall_speed: [1,800],
  travel_speed: [1,1500],
  // Pinned v2.5.0 process profiles also use these four absolute mm/s
  // deposition speeds. No percentages, vectors or relative defaults here.
  sparse_infill_speed: [1,800],
  internal_solid_infill_speed: [1,800],
  top_surface_speed: [1,800],
  gap_infill_speed: [1,800],
  // Pinned CR-10 0.20mm Standard sets bridge_speed to absolute 50 mm/s.
  // Only bounded absolute speed is accepted; percentages are rejected.
  bridge_speed: [1,800],
  // Native bridge_flow is a scalar extrusion multiplier, not a speed or %.
  // This diagnostic range is deliberately narrower than real printer profiles.
  bridge_flow: [0.1,2],
  // Distinct native v2.5.0 internal-bridge extrusion multiplier. Pinned
  // CR-10 0.20mm Standard sets 1 while bridge_flow is 0.95; do not alias.
  // Localhost test only: reject percentages and multi-nozzle vectors.
  internal_bridge_flow: [0.1,2],
  // Pinned v2.5.0 Creality first-layer print speed: 15 mm/s absolute.
  // This is independent of first-layer infill and travel speed.
  initial_layer_speed: [1,800],
  // Source-pinned CR-10 first-layer infill is 20 mm/s, not the
  // first-layer perimeter speed. No relative percentages or vectors.
  initial_layer_infill_speed: [1,800],
  // Native coFloatOrPercent: a first-layer travel percentage is relative to
  // travel_speed, never an absolute mm/s value. Explicit local test only.
  initial_layer_travel_speed: [1,1500],
  // Validated absolute native settings; support generation remains unverified.
  support_line_width: [0.1,2],
  support_speed: [1,800],
  support_interface_speed: [1,800],
};
const INTEGERS = new Set(["wall_loops","skirt_loops","skirt_height","top_shell_layers","bottom_shell_layers"]);
// Exact native v2.5.0 process enum tokens; do not accept labels, numeric
// stand-ins, lists or guessed defaults. This is localhost-only.
const ENUMS = Object.freeze({
  // Source-pinned v2.5.0 enum; not a 0/1 flag or arbitrary text label.
  // This option can alter internal solid regions even with shell layers fixed.
  ensure_vertical_shell_thickness: new Set(["none","ensure_critical_only","ensure_moderate","ensure_all"]),
  wall_generator: new Set(["classic","arachne"]),
  gap_fill_target: new Set(["everywhere","topbottom","nowhere"]),
  // Exact values inspected in the source-pinned Creality v2.5.0 chain.
  // Not an arbitrary native fill-pattern allow-list.
  sparse_infill_pattern: new Set(["grid","crosshatch"]),
  // Pinned CR-10 child uses monotonic; source-pinned v2.5.0 PrintConfig.cpp
  // also lists rectilinear in def_top_fill_pattern used for this coEnum.
  // Only these exact audited tokens enter the isolated localhost lab.
  internal_solid_infill_pattern: new Set(["monotonic","rectilinear"]),
  // v2.5.0 source-pinned CR-10 skin patterns; do not confuse with
  // internal_solid_infill_pattern or unrestricted vendor pattern lists.
  top_surface_pattern: new Set(["monotonic","monotonicline","rectilinear"]),
  bottom_surface_pattern: new Set(["monotonic","monotonicline","rectilinear"]),
  // Explicit, bounded opt-in for support-generation evidence on the localhost
  // COOP/COEP diagnostic page only. Native v2.5.0 stores this bool as "0"/"1".
  // Never infer "1" from a manufacturer profile or deploy this test path on Pages.
  enable_support: new Set(["0","1"]),
});

export function parseTestProcessOverrides(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected a flat process override JSON object.");
  const entries = Object.entries(input);
  if (!entries.length) throw new Error("No process overrides provided.");
  if (entries.length > Object.keys(LIMITS).length + Object.keys(ENUMS).length)
    throw new Error("Too many override settings.");
  const clean = {};
  for(const [key,raw] of entries) {
    if (Object.hasOwn(ENUMS,key)) {
      if (typeof raw !== "string" || !ENUMS[key].has(raw))
        throw new Error("Unsupported native enum value for " + key);
      clean[key] = raw;
      continue;
    }
    // Never look up an untrusted JSON key through Object.prototype.
    // Otherwise keys such as "constructor" or "toString" resolve to inherited
    // functions and bypass the numeric allow-list (undefined range bounds).
    if (!Object.hasOwn(LIMITS, key)) throw new Error("Unsupported process setting: " + key);
    const range = LIMITS[key];
    if (typeof raw !== "number" && typeof raw !== "string")
      throw new Error("Invalid value for " + key);
    if (key === "initial_layer_travel_speed" && typeof raw === "string") {
      const percent = /^(\d+(?:\.\d+)?)%$/.exec(raw.trim());
      if (percent) {
        const ratio = Number(percent[1]);
        if (!Number.isFinite(ratio) || ratio < 1 || ratio > 200)
          throw new Error("Setting " + key + " is outside the safe test range.");
        clean[key] = String(ratio) + "%";
        continue;
      }
    }
    if (typeof raw === "string" && !/^\d+(?:\.\d+)?$/.test(raw.trim()))
      throw new Error("Invalid numeric value for " + key);
    const value = Number(raw);
    if (!Number.isFinite(value) || value < range[0] || value > range[1] ||
       (INTEGERS.has(key) && !Number.isInteger(value)))
      throw new Error("Setting " + key + " is outside the safe test range.");
    clean[key] = String(value);
  }
  return clean;
}

export async function readTestProcessFile(file) {
  if (!file) return null;
  if (!file.name.toLowerCase().endsWith(".json") || file.size > 8192)
    throw new Error("Expected a process JSON file smaller than 8 KB.");
  const object = JSON.parse(await file.text());
  return parseTestProcessOverrides(object);
}
