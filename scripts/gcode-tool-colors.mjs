// Stable diagnostic palette for G-code T selectors, NOT filament RGB or nozzle identity.
// The same selector color is used by isolated 2D and 3D preview surfaces.
const COLORS=Object.freeze(["#f6a45c","#65c6e8","#b0d477","#d6a5f6","#f28b93","#efca69"]);
export function gcodeSelectorColor(toolId,multiTool=false) {
  if(!multiTool||toolId===null||toolId===undefined)return COLORS[0];
  if(!Number.isSafeInteger(toolId)||toolId<0||toolId>255)
    throw new Error("Invalid G-code tool selector");
  return COLORS[toolId%COLORS.length];
}
