import {parseTestProcessOverrides} from "./test-process-profile.mjs";
import {makeMultiStlProject} from "./multi-stl.mjs";
import {viewerMatrixToNative} from "./transform-matrix.mjs";
// Experimental end-to-end bridge for an isolated browser host.
// Uses the vendored one-slicer-api 0.7.0 interface, not display-only meshes.
const encode = value => new TextEncoder().encode(JSON.stringify(value));

export const GENERIC_PLA_TEST_CONFIG = Object.freeze({
  bed_size_x: 256,
  bed_size_y: 256,
  printable_height: 250,
  nozzle_diameter: 0.4,
  layer_height: 0.2,
  initial_layer_print_height: 0.2,
  wall_loops: 2,
  top_shell_layers: 3,
  bottom_shell_layers: 3,
  sparse_infill_density: 15,
  sparse_infill_pattern: "grid",
  filament_type: "PLA",
  nozzle_temperature: 220,
  bed_temperature: 55,
});

export function makeSingleStlManifest(stlBytes, viewerElements = null) {
  if (!(stlBytes instanceof Uint8Array) || stlBytes.byteLength < 134)
    throw new Error("Input must be non-empty STL bytes");
  return {
    schemaVersion: "0.7.0",
    plates: [{ id: "plate-0", index: 0 }],
    meshes: [{ id: "mesh-0", format: "stl", dataRange: {offset: 0, length: stlBytes.byteLength} }],
    objects: [{ id: "object-0", meshId: "mesh-0" }],
    instances: [{
      id: "instance-0",
      objectId: "object-0",
      plateId: "plate-0",
      transform: { matrix: viewerElements
        ? viewerMatrixToNative(viewerElements)
        : [1,0,0,128, 0,1,0,128, 0,0,1,0, 0,0,0,1] },
    }],
    modifierVolumes: [],
  };
}

export async function sliceStlWithEngine(engine, stlBytes, onProgress, viewerElements = null) {
  return sliceMultiStlWithEngine(engine, [{bytes:stlBytes,viewerElements}], onProgress);
}

// The profile reader resolves the process branch separately from machine
// and filament. Never silently drop it when a caller supplies a collection
// without repeating its process settings as an explicit override.
// This is a restricted localhost test adapter, NOT a full native PrintConfig.
export function resolveRestrictedProcessSettings(processOverrides = null, profileCollection = null) {
  let fromCollection = null;
  if (profileCollection !== null) {
    const source = profileCollection?.process?.settings;
    if (!source || typeof source !== "object" || Array.isArray(source) ||
        Object.keys(source).length === 0)
      throw new Error("Selected Orca process profile has no supported settings.");
    fromCollection = parseTestProcessOverrides(source);
  }
  const manual = processOverrides === null ? null
    : parseTestProcessOverrides(processOverrides);
  // Explicit user overrides take precedence, retaining the remaining inherited
  // process fields. Each source is independently allow-listed and bounded.
  return fromCollection && manual ? {...fromCollection, ...manual}
    : fromCollection ?? manual;
}

export async function sliceMultiStlWithEngine(engine, items, onProgress, processOverrides = null, profileCollection = null) {
  if (!engine || typeof engine.createSession !== "function")
    throw new Error("Verified OrcaSlicer engine must be loaded before slicing.");
  // Validate before creating the native WASM session (fail closed).
  const effectiveProcess = resolveRestrictedProcessSettings(processOverrides, profileCollection);
  const session = await engine.createSession();
  try {
    // Apply only explicitly vetted numeric machine/filament fragments.
    // Unsupported full Orca settings are NOT silently forwarded.
    const base = profileCollection ? {
      ...GENERIC_PLA_TEST_CONFIG,
      ...profileCollection.machine.settings,
      ...profileCollection.filament.settings,
    } : GENERIC_PLA_TEST_CONFIG;
    await session.init(encode(base));
    if (effectiveProcess !== null) {
      // Apply one validated effective process fragment, including any selected
      // inherited settings and explicit overrides, before objects and slicing.
      await session.applyProfile("orca.native-json", encode(effectiveProcess));
    }
    const project = makeMultiStlProject(items);
    await session.setObjects(project.blob, project.manifest);
    const response = await session.slice({
      schemaVersion: "0.7.0",
      plateSelection: "selected",
      plateIds: ["plate-0"],
      includeGcode: true,
      includeStatistics: true,
    }, {onProgress});
    const result = response?.plateResults?.find(plate => plate.plateId === "plate-0");
    const asset = result?.assets?.find(item => item.kind === "gcode");
    if (response?.schemaVersion !== "0.7.0" || !asset?.id)
      throw new Error("Engine did not return a plate-0 G-code asset.");
    const gcode = await session.getAsset(asset.id);
    if (!(gcode instanceof Uint8Array) || gcode.byteLength < 200)
      throw new Error("Engine returned empty or suspiciously short G-code.");
    const gcodeText = new TextDecoder().decode(gcode);
    if (!/(?:^|\n)G1\s/m.test(gcodeText))
      throw new Error("Generated G-code has no G1 motion commands.");
    return {gcode, statistics: result?.statistics ?? null, response};
  } finally {
    await session.dispose();
  }
}
