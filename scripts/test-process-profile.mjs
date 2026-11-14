// Local test overrides for the pinned OrcaSlicer one-slicer-api.
// These are process overrides ONLY, not a complete machine/material preset.
// Native profile JSON uses flat scalar keys; do not silently accept unknown
// machine settings, inherited profile trees, or untrusted executable content.
const LIMITS = {
  layer_height: [0.06,0.4],
  wall_loops: [1,8],
  sparse_infill_density: [0,100],
  top_shell_layers: [0,12],
  bottom_shell_layers: [0,12],
  // Absolute millimetres/second for localhost WASM tests only.
  // Percentages and vendor-specific relative speed modes remain unsupported.
  outer_wall_speed: [1,800],
  inner_wall_speed: [1,800],
  travel_speed: [1,1500],
};
const INTEGERS = new Set(["wall_loops","top_shell_layers","bottom_shell_layers"]);

export function parseTestProcessOverrides(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected a flat process override JSON object.");
  const entries = Object.entries(input);
  if (!entries.length) throw new Error("No process overrides provided.");
  if (entries.length > Object.keys(LIMITS).length)
    throw new Error("Too many override settings.");
  const clean = {};
  for(const [key,raw] of entries) {
    const range = LIMITS[key];
    if (!range) throw new Error("Unsupported process setting: " + key);
    if (typeof raw !== "number" && typeof raw !== "string")
      throw new Error("Invalid value for " + key);
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
