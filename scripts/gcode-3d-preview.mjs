import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";

// Experimental G-code-derived 3D line preview in the *local isolated lab*.
// Coordinates are native G-code millimeters, not reconstructed STL geometry.
// Maximum 200k parsed segments is enforced by the shared parser.
export function createThreeDToolpathPreview(container) {
  const section=document.createElement("section");
  section.className="gcode-3d-preview";
  section.hidden=true;
  section.innerHTML=`
    <h3>3D G-code paths (experimental)</h3>
    <label>Visible through layer <input id="lab-3d-layer-range" type="range" min="0" max="0" value="0" step="1"></label>
    <output id="lab-3d-layer-info"></output>
    <div id="lab-3d-canvas" aria-label="3D G-code toolpath preview" role="img"></div>
    <p>Orange: extrusion; blue-gray: travel. XY G2/G3 I/J and signed-R arcs appear as approximated line segments; helical, non-XY, ambiguous and invalid arcs are omitted. This is not native OrcaSlicer Preview or a print safety check.</p>
  `;
  container.appendChild(section);
  const host=section.querySelector("#lab-3d-canvas");
  const slider=section.querySelector("#lab-3d-layer-range");
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
  let layers=[],layerObjects=[];
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
    for(let i=0;i<layerObjects.length;i++)layerObjects[i].visible=i<=index;
    const visible=layers[index];
    info.textContent=`${index+1}/${layers.length} · Z=${visible?.z?.toFixed(3)??"?"} mm`;
    host.dataset.visibleLayers=String(index+1);
    renderer.render(scene,camera);
  }
  slider.addEventListener("input",()=>through(Number(slider.value)));
  return {
    show(data) {
      cleanup();layers=data.layers;
      if(!layers.length)throw new Error("No layers for 3D preview");
      const extent=new THREE.Box3();
      for(const layer of layers) {
        const group=new THREE.Group();
        for (const extrusion of [true,false]) {
          const points=[];
          for (const segment of layer.segments) {
            if(segment.extrusion!==extrusion)continue;
            const z=layer.z;
            // Three.js Z-up matches the Prepare viewport.
            points.push(segment.x1,segment.y1,z,segment.x2,segment.y2,z);
            extent.expandByPoint(new THREE.Vector3(segment.x1,segment.y1,z));
            extent.expandByPoint(new THREE.Vector3(segment.x2,segment.y2,z));
          }
          if(points.length) {
            const geo=new THREE.BufferGeometry();
            geo.setAttribute("position",new THREE.Float32BufferAttribute(points,3));
            group.add(new THREE.LineSegments(geo,extrusion?materialExtrusion:materialTravel));
          }
        }
        geometryGroup.add(group);layerObjects.push(group);
      }
      if(extent.isEmpty())throw new Error("No 3D line positions");
      const center=extent.getCenter(new THREE.Vector3());
      const size=extent.getSize(new THREE.Vector3());
      const distance=Math.max(70,Math.max(size.x,size.y,size.z)*2.2);
      controls.target.copy(center);
      camera.position.set(center.x+distance*.8,center.y-distance,center.z+distance*.75);
      controls.update();
      slider.max=String(layers.length-1);
      slider.value=String(layers.length-1);
      section.hidden=false;resize();through(layers.length-1);
      startPaint();
      host.dataset.segmentCount=String(data.segments);
      return layerObjects.length;
    },
    clear() {cleanup();layers=[];section.hidden=true;host.dataset.segmentCount="0";},
  };
}
