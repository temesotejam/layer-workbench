import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {gcodeSelectorColor} from "./gcode-tool-colors.mjs";
import {COMMANDED_SPEED_BANDS,commandedSpeedBand,commandedSpeedLegend} from "./gcode-speed-colors.mjs";
import {gcodeSegment3DVertices} from "./gcode-3d-vertices.mjs";
import {ALL_GCODE_PATHS,visibleGcodeSegment} from "./gcode-feature-filter.mjs";

// Experimental G-code-derived 3D line preview in the *local isolated lab*.
// Coordinates are native G-code millimeters, not reconstructed STL geometry.
// Maximum 200k parsed segments is enforced by the shared parser.
export function createThreeDToolpathPreview(container) {
  const section=document.createElement("section");
  section.className="gcode-3d-preview";
  section.hidden=true;
  section.innerHTML=`
    <h3>3D G-code paths (experimental)</h3>
    <label>Selected layer <input id="lab-3d-layer-range" type="range" min="0" max="0" value="0" step="1"></label>
    <label>Layer display <select id="lab-3d-layer-mode" aria-label="3D layer display mode"><option value="through">Through selected layer</option><option value="single">Selected layer only</option></select></label>
    <label>3D extrusion color <select id="lab-3d-color-mode" aria-label="3D extrusion color mode"><option value="tool">Tool selector</option><option value="speed">Commanded F speed</option></select></label>
    <output id="lab-3d-color-legend" aria-live="polite"></output>
    <output id="lab-3d-layer-info"></output>
    <div id="lab-3d-canvas" aria-label="3D G-code toolpath preview" role="img"></div>
    <p>Choose accumulated layers or a single Z layer. Changing the 2D type selector also filters 3D deposition paths; this follows only explicit G-code feature comments. Tool-selector mode uses orange for one/unknown T selector and distinct colors for multiple T selectors. Commanded-speed mode groups modal G-code F values in mm/s; it does not show achieved motion speed or account for acceleration. Blue-gray: travel. XY planar and helical arcs are approximated; non-XY and invalid arcs are omitted. Diagnostic only; not native OrcaSlicer Preview or a print safety check.</p>
  `;
  container.appendChild(section);
  const host=section.querySelector("#lab-3d-canvas");
  const slider=section.querySelector("#lab-3d-layer-range");
  const layerModeSelect=section.querySelector("#lab-3d-layer-mode");
  const colorSelect=section.querySelector("#lab-3d-color-mode");
  const colorLegend=section.querySelector("#lab-3d-color-legend");
  const info=section.querySelector("#lab-3d-layer-info");
  const scene=new THREE.Scene();
  scene.background=new THREE.Color("#171d24");
  const camera=new THREE.PerspectiveCamera(45,1,0.1,100000);
  camera.up.set(0,0,1);
  camera.position.set(250,-300,200);
  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  renderer.setSize(360,360);
  host.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  const geometryGroup=new THREE.Group();
  scene.add(geometryGroup);
  const materialExtrusion=new THREE.LineBasicMaterial({color:0xffad61});
  const materialTravel=new THREE.LineBasicMaterial({color:0x7e98b1,transparent:true,opacity:0.35});
  const materialByTool=new Map();
  const materialBySpeed=new Map();
  function speedMaterial(id) {
    if(!materialBySpeed.has(id)){
      const band=COMMANDED_SPEED_BANDS.find(item=>item.id===id);
      if(!band)throw new Error("Unknown G-code speed bucket");
      materialBySpeed.set(id,new THREE.LineBasicMaterial({color:band.color}));
    }
    return materialBySpeed.get(id);
  }
  function toolMaterial(id) {
    if(!materialByTool.has(id))
      materialByTool.set(id,new THREE.LineBasicMaterial({color:gcodeSelectorColor(id,true)}));
    return materialByTool.get(id);
  }
  let layers=[],layerObjects=[],layerSegmentCounts=[],lastData=null,lastFeature=ALL_GCODE_PATHS;
  const cleanup=()=>{
    for(const group of layerObjects) {
      for(const child of group.children)child.geometry.dispose();
      geometryGroup.remove(group);
    }
    layerObjects=[];
  };
  const resize=()=>{
    const width=Math.max(1,host.clientWidth||360);
    const height=Math.max(1,host.clientHeight||360);
    renderer.setSize(width,height,false);
    camera.aspect=width/height;
    camera.updateProjectionMatrix();
  };
  const observer=new ResizeObserver(resize);
  observer.observe(host);
  const paint=()=>{
    if(section.hidden)return;
    controls.update();
    renderer.render(scene,camera);
    requestAnimationFrame(paint);
  };
  let painting=false;
  const startPaint=()=>{
    if(painting)return;
    painting=true;
    const loop=()=>{
      if(section.hidden){painting=false;return;}
      controls.update();renderer.render(scene,camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  function through(index) {
    const single=layerModeSelect.value==="single";
    let visibleLayers=0,visibleSegments=0;
    for(let i=0;i<layerObjects.length;i++) {
      const visible=single?i===index:i<=index;
      layerObjects[i].visible=visible;
      if(visible){visibleLayers++;visibleSegments+=layerSegmentCounts[i];}
    }
    const layer=layers[index];
    info.textContent=`${index+1}/${layers.length} · Z=${layer?.z?.toFixed(3)??"?"} mm · ${single?"selected layer only":"through selected layer"}`;
    host.dataset.visibleLayers=String(visibleLayers);
    host.dataset.visibleSegments=String(visibleSegments);
    host.dataset.layerMode=single?"single":"through";
    renderer.render(scene,camera);
  }
  slider.addEventListener("input",()=>through(Number(slider.value)));
  layerModeSelect.addEventListener("change",()=>{
    if(layerObjects.length)through(Number(slider.value));
  });
  const preview={
    show(data,{featureFilter=ALL_GCODE_PATHS,preserveView=false}={}) {
      const retainLayer=preserveView&&lastData===data;
      const savedLayer=Number(slider.value);
      lastData=data;lastFeature=featureFilter;
      const speedMode=colorSelect.value==="speed";
      const previousTarget=controls.target.clone();
      const previousPosition=camera.position.clone();
      cleanup();layers=data.layers;layerSegmentCounts=[];
      if(!layers.length)throw new Error("No layers for 3D preview");
      const extent=new THREE.Box3();
      const multi=Array.isArray(data.selectedToolIds)&&data.selectedToolIds.length>1;
      const selectors=speedMode?COMMANDED_SPEED_BANDS.map(b=>b.id)
        :(multi?[null,...data.selectedToolIds]:[null]);
      let visibleSegmentCount=0;
      const activeColorClasses=new Set();
      for(const layer of layers) {
        const group=new THREE.Group();
        let layerCount=0;
        for (const extrusion of [true,false]) {
          for(const toolId of extrusion?selectors:[null]){
            const points=[];
            for (const segment of layer.segments) {
              if(!visibleGcodeSegment(segment,featureFilter) ||
                 segment.extrusion!==extrusion)continue;
              if(extrusion && (speedMode
                  ? commandedSpeedBand(segment.feedrateMmMin).id!==toolId
                  : (multi&&segment.toolId!==toolId)))continue;
              visibleSegmentCount++;layerCount++;
              if(extrusion)activeColorClasses.add(speedMode?toolId:(segment.toolId??"unselected"));
              // Keep actual endpoint heights (including Z-only travel).
              // Three.js Z-up matches the Prepare viewport.
              const [x1,y1,z1,x2,y2,z2]=gcodeSegment3DVertices(segment,layer.z);
              points.push(x1,y1,z1,x2,y2,z2);
              extent.expandByPoint(new THREE.Vector3(x1,y1,z1));
              extent.expandByPoint(new THREE.Vector3(x2,y2,z2));
            }
            if(points.length) {
              const geo=new THREE.BufferGeometry();
              geo.setAttribute("position",new THREE.Float32BufferAttribute(points,3));
              const material=extrusion
                ?(speedMode?speedMaterial(toolId):(multi?toolMaterial(toolId):materialExtrusion))
                :materialTravel;
              group.add(new THREE.LineSegments(geo,material));
            }
          }
        }
        geometryGroup.add(group);layerObjects.push(group);layerSegmentCounts.push(layerCount);
      }
      if(extent.isEmpty())throw new Error("No 3D line positions");
      const center=extent.getCenter(new THREE.Vector3());
      const size=extent.getSize(new THREE.Vector3());
      const distance=Math.max(70,Math.max(size.x,size.y,size.z)*2.2);
      if(preserveView){
        controls.target.copy(previousTarget);
        camera.position.copy(previousPosition);
      }else{
        controls.target.copy(center);
        camera.position.set(center.x+distance*.8,center.y-distance,center.z+distance*.75);
      }
      controls.update();
      slider.max=String(layers.length-1);
      slider.value=String(retainLayer&&Number.isInteger(savedLayer)?Math.max(0,Math.min(layers.length-1,savedLayer)):layers.length-1);
      section.hidden=false;resize();through(Number(slider.value));
      startPaint();
      host.dataset.segmentCount=String(visibleSegmentCount);
      host.dataset.featureFilter=featureFilter;
      host.dataset.colorMode=speedMode?"speed":"tool";
      host.dataset.activeColorClasses=String(activeColorClasses.size);
      colorLegend.textContent=speedMode?commandedSpeedLegend():
        "T selector labels only; colors are not filament identities";
      return layerObjects.length;
    },
    clear() {cleanup();layers=[];layerSegmentCounts=[];lastData=null;lastFeature=ALL_GCODE_PATHS;section.hidden=true;host.dataset.segmentCount="0";host.dataset.visibleSegments="0";host.dataset.visibleLayers="0";host.dataset.layerMode="through";host.dataset.featureFilter=ALL_GCODE_PATHS;host.dataset.colorMode="tool";colorSelect.value="tool";layerModeSelect.value="through";colorLegend.textContent="";},
  };
  colorSelect.addEventListener("change",()=>{
    if(lastData)preview.show(lastData,{featureFilter:lastFeature,preserveView:true});
  });
  return preview;
}
