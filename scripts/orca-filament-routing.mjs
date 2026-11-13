// Source-only inspection of OrcaSlicer v2.5.0's 1-based filament_map.
// Never invent tool assignments from a machine's nozzle count or turn this
// report into a WASM PrintConfig / real-printer configuration.
import {inspectOrcaNozzleVector} from "./orca-full-profile.mjs";

export const ORCA_FILAMENT_MAP_SOURCE = Object.freeze({
  repository:"OrcaSlicer/OrcaSlicer",
  commit:"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19",
  file:"src/libslic3r/PrintConfig.cpp",
  definition:'this->add("filament_map", coInts)',
  lookup:"get_extruder_index"
});

function parseExtruderId(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Invalid filament_map extruder ID");
    return value;
  }
  // Vendor JSON profiles encode many ConfigOptionInts as decimal strings.
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const id = Number(value);
    if (Number.isSafeInteger(id)) return id;
  }
  throw new Error("Invalid filament_map extruder ID");
}

/**
 * Inspect an EXPLICIT, per-filament map, not a guessed default.
 * Native v2.5.0 uses filament_map.get_at(filament_id) - 1;
 * it is a 1-based physical extruder ID, not a zero-based array index.
 * Repeated IDs are allowed (several filaments can reference the same tool).
 */
export function inspectOrcaFilamentRouting(machine, explicitFilamentMap) {
  const nozzle = inspectOrcaNozzleVector(machine);
  if (!Array.isArray(explicitFilamentMap) ||
      explicitFilamentMap.length === 0 || explicitFilamentMap.length > 64)
    throw new Error("An explicit non-empty filament_map vector is required");
  const routing = explicitFilamentMap.map((raw, filamentIndex) => {
    const extruderId = parseExtruderId(raw);
    if (extruderId < 1 || extruderId > nozzle.toolCount)
      throw new Error("filament_map extruder ID outside available nozzle range");
    const extruderIndex = extruderId - 1;
    return {
      filamentIndex,
      filamentId:filamentIndex + 1,
      extruderId,
      extruderIndex,
      nozzleDiameterMm:nozzle.nozzleDiametersMm[extruderIndex]
    };
  });
  return {
    machineProfile:machine.name,
    toolCount:nozzle.toolCount,
    filamentCount:routing.length,
    routing,
    source:ORCA_FILAMENT_MAP_SOURCE,
    usableForPrinting:false,
    validation:"inspection-only: does not validate filament presets, offsets, scripts, or G-code"
  };
}
