import {createThreeDToolpathPreview} from "./gcode-3d-preview.mjs";
import {parseGcodeToolpaths} from "./gcode-preview-parser.mjs";
import {gcodeSelectorColor} from "./gcode-tool-colors.mjs";

// 2D, per-Z-layer read-only toolpath viewer for the isolated development lab.
// Does not pretend to be the native OrcaSlicer 3D G-code Preview.
export function createLayerPreview(container) {
  const section=document.createElement("section");
  section.className="gcode-layer-preview";
  section.hidden=true;
  section.innerHTML=`
    <h3>G-code layer preview (experimental 2D)</h3>
    <div class="gcode-layer-controls">
      <label>Layer <input type="range" min="0" max="0" step="1" value="0" id="lab-layer-range"></label>
      <output id="lab-layer-info"></output>
    </div>
    <canvas id="lab-toolpath-canvas" width="360" height="360" role="img" aria-label="Generated G-code extrusion and travel toolpaths by layer"></canvas>
    <p id="lab-preview-stats"></p>
    <p>Extrusion is orange for one/unknown T selector; multiple T selectors use distinct colors. Gray dashed: travel. Colors identify G-code T numbers, not actual filament colors or physical nozzles. G0/G1 and XY G2/G3 I/J or R arcs are approximated; helical, non-XY, invalid arcs and firmware macros are omitted. Diagnostic only.</p>
  `;
  container.appendChild(section);
  const threeD=createThreeDToolpathPreview(container);
  const canvas=section.querySelector("canvas");
  const slider=section.querySelector("#lab-layer-range");
  const info=section.querySelector("#lab-layer-info");
  const stats=section.querySelector("#lab-preview-stats");
  const ctx=canvas.getContext("2d");
  let parsed=null;
  function render(index) {
    if(!parsed)return;
    const layer=parsed.layers[index];
    if(!layer)return;
    const w=canvas.width,h=canvas.height;
    ctx.fillStyle="#171d24";
    ctx.fillRect(0,0,w,h);
    const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
    for(const segment of layer.segments){
      bounds.minX=Math.min(bounds.minX,segment.x1,segment.x2);
      bounds.minY=Math.min(bounds.minY,segment.y1,segment.y2);
      bounds.maxX=Math.max(bounds.maxX,segment.x1,segment.x2);
      bounds.maxY=Math.max(bounds.maxY,segment.y1,segment.y2);
    }
    const dx=Math.max(bounds.maxX-bounds.minX,1);
    const dy=Math.max(bounds.maxY-bounds.minY,1);
    const scale=Math.min((w-30)/dx,(h-30)/dy);
    const mapX=x=>(w-dx*scale)/2+(x-bounds.minX)*scale;
    const mapY=y=>h-((h-dy*scale)/2+(y-bounds.minY)*scale);
    ctx.lineWidth=1.25;
    // Keep travel on one dashed pass. Multi-material labels color only
    // extrusion paths, without interpreting vendor tool-change macros.
    const multi=parsed.selectedToolIds.length>1;
    const selected=multi?[null,...parsed.selectedToolIds]:[null];
    ctx.beginPath();
    ctx.strokeStyle="#718399";
    ctx.setLineDash([3,3]);
    for(const segment of layer.segments){
      if(segment.extrusion)continue;
      ctx.moveTo(mapX(segment.x1),mapY(segment.y1));
      ctx.lineTo(mapX(segment.x2),mapY(segment.y2));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for(const toolId of selected){
      ctx.beginPath();
      ctx.strokeStyle=gcodeSelectorColor(toolId,multi);
      for(const segment of layer.segments){
        if(!segment.extrusion || (multi&&segment.toolId!==toolId))continue;
        ctx.moveTo(mapX(segment.x1),mapY(segment.y1));
        ctx.lineTo(mapX(segment.x2),mapY(segment.y2));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    info.textContent=`${index+1}/${parsed.layers.length} · Z=${layer.z.toFixed(3)} mm · ${layer.segments.length} segments`;
    canvas.dataset.segmentCount=String(layer.segments.length);
  }
  slider.addEventListener("input",()=>render(Number(slider.value)));
  return {
    show(gcode) {
      parsed=parseGcodeToolpaths(gcode);
      if(!parsed.layers.length || !parsed.extrusions) {
        section.hidden=true;
        throw new Error("No drawable linear extrusion toolpaths in G-code");
      }
      slider.max=String(parsed.layers.length-1);
      slider.value=String(parsed.layers.length-1);
      const selectors=parsed.selectedToolIds.length>1?` · T selectors: ${parsed.selectedToolIds.map(id=>"T"+id).join(", ")}`:"";
      stats.textContent=`${parsed.layers.length} Z levels · ${parsed.extrusions} extrusion segments · ${parsed.travels} travel segments · ${parsed.renderedArcs} approximated XY arcs · ${parsed.skippedArcs} unsupported arcs · ${parsed.skippedMalformedMotion} malformed motion commands omitted${selectors}`;
      section.hidden=false;
      render(Number(slider.value));
      threeD.show(parsed);
      return parsed;
    },
    clear() {parsed=null;section.hidden=true;canvas.dataset.segmentCount="0";threeD.clear();},
  };
}
