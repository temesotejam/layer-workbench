// Independent numerical placement witness from actual isolated-WASM G-code,
// not from the input manifest or rendered Three.js mesh. Test-only: toolpath
// bounds do not prove internal triangle identity, equal profiles or print safety.
// Call with parseGcodeToolpaths(gcode) from the read-only G-code parser.
const EXPECTED_XY = [128, 148];
const INCLUSION_MARGIN_MM = 1;
const MIN_DEPOSITED = 50;
const MIN_INSIDE_FRACTION = 0.85;
const MIN_XY_SPAN_MM = 18.5;

export function auditWasmCubeDeposition(parsed) {
  if (!parsed || !Array.isArray(parsed.layers) ||
      !Number.isSafeInteger(parsed.skippedArcs) ||
      !Number.isSafeInteger(parsed.skippedMalformedMotion))
    throw new Error('Expected bounded G-code parser result');
  const segments = [];
  for (const layer of parsed.layers) {
    if (!Array.isArray(layer.segments)) throw new Error('Invalid parsed G-code layer');
    for (const s of layer.segments) {
      if (s.extrusion !== true) continue;
      const coords = [s.x1, s.y1, s.z1, s.x2, s.y2, s.z2];
      if (!coords.every(Number.isFinite)) throw new Error('Nonfinite deposited coordinates');
      if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 1e-6) segments.push(s);
    }
  }
  const inside = segments.filter(s => [
    [s.x1, s.y1, s.z1], [s.x2, s.y2, s.z2],
  ].every(([x,y,z]) =>
    x >= EXPECTED_XY[0] - INCLUSION_MARGIN_MM &&
    x <= EXPECTED_XY[1] + INCLUSION_MARGIN_MM &&
    y >= EXPECTED_XY[0] - INCLUSION_MARGIN_MM &&
    y <= EXPECTED_XY[1] + INCLUSION_MARGIN_MM &&
    z >= -0.1 && z <= 20.6));
  // Running extrema avoid a giant spread/temporary array for real toolpaths.
  const bounds = inside.length ? [[Infinity,-Infinity],[Infinity,-Infinity],[Infinity,-Infinity]] : null;
  if (bounds) for (const s of inside) for (const p of [[s.x1,s.y1,s.z1],[s.x2,s.y2,s.z2]]) {
    for (let axis=0;axis<3;axis++) {
      if (p[axis]<bounds[axis][0]) bounds[axis][0]=p[axis];
      if (p[axis]>bounds[axis][1]) bounds[axis][1]=p[axis];
    }
  }
  const insideFraction = segments.length ? inside.length / segments.length : 0;
  const spanOK = bounds !== null &&
    bounds[0][1] - bounds[0][0] >= MIN_XY_SPAN_MM &&
    bounds[1][1] - bounds[1][0] >= MIN_XY_SPAN_MM &&
    bounds[2][0] >= 0 && bounds[2][0] <= 0.6 &&
    bounds[2][1] >= 19.2 && bounds[2][1] <= 20.6;
  return {
    passed: segments.length >= MIN_DEPOSITED &&
      insideFraction >= MIN_INSIDE_FRACTION && spanOK &&
      parsed.skippedArcs === 0 && parsed.skippedMalformedMotion === 0,
    parity_pass: false,
    source: 'actual generated G-code XY deposited paths (not scene metadata)',
    expected_cube_xyz_bounds_mm: [[128,148],[128,148],[0,20]],
    deposited_xy_segments: segments.length,
    inside_cube_envelope_segments: inside.length,
    inside_fraction: insideFraction,
    observed_inside_xyz_bounds_mm: bounds,
    skipped_arcs: parsed.skippedArcs,
    skipped_malformed_motion: parsed.skippedMalformedMotion,
  };
}
