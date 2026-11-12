import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";

const picker = document.querySelector("#model-file");
const status = document.querySelector("#file-status");
const tree = document.querySelector("#object-tree");
const projectLabel = document.querySelector("#project-label");
const sceneFile = document.querySelector("#scene-file");
const sliceNote = document.querySelector("#slice-note");
const scene = document.querySelector("#scene");
const canvasHost = document.querySelector("#viewport-canvas");
const emptyHint = document.querySelector("#scene-empty");
const transformButtons = [...document.querySelectorAll("[data-transform]")];
const deleteButton = document.querySelector("#remove-object");
const fitButton = document.querySelector("#fit-view");
const transformStatus = document.querySelector("#transform-status");
const objectCount = document.querySelector("#object-count");
const transformInputs = Object.fromEntries(["x","y","z","rz","sx","sy","sz"].map(key =>
  [key, document.querySelector("#transform-" + key)]
));
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const accepted = new Set(["stl", "3mf", "obj"]);
const entries = [];
let selectedId = null;
let renderer, camera, controls, transformControls;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;
let rendererReady = false;

const world = new THREE.Scene();
world.background = new THREE.Color("#20252c");
world.fog = new THREE.Fog("#20252c", 900, 2200);
camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000);
camera.up.set(0, 0, 1);
camera.position.set(330, -420, 310);
world.add(new THREE.HemisphereLight(0xdce8f4, 0x343943, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(-220, -260, 420);
world.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x8ba9d1, 0.8);
fillLight.position.set(240, 180, 180);
world.add(fillLight);

const plate = new THREE.Mesh(
  new THREE.PlaneGeometry(256, 256),
  new THREE.MeshStandardMaterial({ color: "#353c45", roughness: 0.88, metalness: 0.05, side: THREE.DoubleSide })
);
plate.position.z = -0.8;
world.add(plate);
const grid = new THREE.GridHelper(256, 32, 0x82909e, 0x58616c);
grid.rotation.x = Math.PI / 2;
grid.position.z = -0.35;
world.add(grid);
const plateBorder = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(256, 256)),
  new THREE.LineBasicMaterial({ color: 0x9ba8b7 })
);
plateBorder.position.z = -0.2;
world.add(plateBorder);
const axes = new THREE.AxesHelper(45);
axes.position.set(-142, -142, 0);
world.add(axes);

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvasHost.clientWidth || 640, canvasHost.clientHeight || 480);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  canvasHost.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.target.set(0, 0, 35);
  controls.minDistance = 25;
  controls.maxDistance = 1800;
  controls.update();
  transformControls = new TransformControls(camera, renderer.domElement);
  world.add(transformControls.getHelper());
  transformControls.addEventListener("dragging-changed", event => {
    controls.enabled = !event.value;
    if (!event.value) updateTransformStatus();
  });
  transformControls.addEventListener("objectChange", () => {
    const entry = entries.find(item => item.id === selectedId);
    if (entry) entry.modified = true;
    updateTransformStatus();
  });
  renderer.domElement.addEventListener("pointerdown", event => {
    pointerDown = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener("pointerup", event => {
    if (!pointerDown || event.button !== 0 || transformControls.dragging) return;
    const movement = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;
    if (movement > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(entries.map(entry => entry.object), true);
    if (hits.length) {
      const hit = hits[0].object;
      const entry = entries.find(candidate => {
        let node = hit;
        while (node) {
          if (node === candidate.object) return true;
          node = node.parent;
        }
        return false;
      });
      if (entry) selectEntry(entry.id);
    }
  });
  rendererReady = true;
  const resizeObserver = new ResizeObserver(() => {
    if (!rendererReady) return;
    const width = Math.max(1, canvasHost.clientWidth);
    const height = Math.max(1, canvasHost.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });
  resizeObserver.observe(canvasHost);
  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(world, camera);
  };
  animate();
} catch (error) {
  status.textContent = "WebGL initialization failed: " + error.message;
  sliceNote.textContent = "This browser could not initialize WebGL.";
}

function humanSize(bytes) {
  return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(2) + " MB" : (bytes / 1024).toFixed(1) + " KB";
}
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
}
function renderObjects() {
  objectCount.textContent = entries.length + (entries.length === 1 ? " object" : " objects");
  if (!entries.length) {
    tree.innerHTML = '<div class="empty-object"><span class="cube-icon">◇</span><strong>No objects yet</strong><small>Import an STL, 3MF or OBJ file to begin.</small></div>';
    return;
  }
  tree.innerHTML = entries.map(entry =>
    '<button class="object-item ' + (entry.id === selectedId ? "active" : "") + '" data-object-id="' + entry.id + '">' +
    '<span class="object-glyph">◇</span><span class="object-name" title="' + escapeText(entry.name) + '">' + escapeText(entry.name) +
    '</span><span class="object-size">' + humanSize(entry.size) + '</span></button>'
  ).join("");
  tree.querySelectorAll("[data-object-id]").forEach(button => button.addEventListener("click", () => selectEntry(button.dataset.objectId)));
}
function selectEntry(id) {
  selectedId = id;
  renderObjects();
  const entry = entries.find(item => item.id === id);
  if (transformControls) {
    transformControls.detach();
    if (entry) transformControls.attach(entry.object);
  }
  transformButtons.forEach(button => { button.disabled = !entry; });
  deleteButton.disabled = !entry;
  entries.forEach(item => item.object?.traverse(node => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach(material => {
      if (material?.emissive) material.emissive.set(item.id === id ? 0x172b24 : 0x000000);
    });
  }));
  updateTransformStatus();
}

function updateTransformStatus() {
  const entry = entries.find(item => item.id === selectedId);
  Object.values(transformInputs).forEach(input => { input.disabled = !entry; });
  if (entry) {
    const p = entry.object.position, r = entry.object.rotation, sc = entry.object.scale;
    const values = {x:p.x, y:p.y, z:p.z, rz:THREE.MathUtils.radToDeg(r.z), sx:sc.x, sy:sc.y, sz:sc.z};
    for (const [key, input] of Object.entries(transformInputs)) {
      if (document.activeElement !== input) input.value = String(Math.round(values[key] * 1000) / 1000);
    }
  }
  if (!entry) {
    transformStatus.textContent = "Select an imported model to move, rotate or scale it. Browser-only edits are not saved.";
    return;
  }
  const p = entry.object.position;
  const r = entry.object.rotation;
  const sc = entry.object.scale;
  const fmt = value => Number(value).toFixed(1);
  transformStatus.textContent = `${entry.name} · Position: ${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)} mm · Rotation: ${fmt(THREE.MathUtils.radToDeg(r.x))}°, ${fmt(THREE.MathUtils.radToDeg(r.y))}°, ${fmt(THREE.MathUtils.radToDeg(r.z))}° · Scale: ${fmt(sc.x)}, ${fmt(sc.y)}, ${fmt(sc.z)} (viewer only)`;
}

for (const [key, input] of Object.entries(transformInputs)) {
  input.addEventListener("change", () => {
    const entry = entries.find(item => item.id === selectedId);
    if (!entry) return;
    const value = Number(input.value);
    if (!Number.isFinite(value) || Math.abs(value) > 5000 ||
        (key.startsWith("s") && (value <= 0.01 || value > 20))) {
      updateTransformStatus();
      return;
    }
    if (["x","y","z"].includes(key)) entry.object.position[key] = value;
    if (key === "rz") entry.object.rotation.z = THREE.MathUtils.degToRad(value);
    if (["sx","sy","sz"].includes(key)) entry.object.scale[key.slice(1)] = value;
    entry.object.updateMatrixWorld(true);
    entry.modified = true;
    updateTransformStatus();
  });
}

function setTransformMode(mode) {
  if (!transformControls || !entries.some(item => item.id === selectedId)) return;
  if (!["translate", "rotate", "scale"].includes(mode)) return;
  transformControls.setMode(mode);
  transformButtons.forEach(button => button.classList.toggle("active-tool", button.dataset.transform === mode));
}

transformButtons.forEach(button => button.addEventListener("click", () => setTransformMode(button.dataset.transform)));
deleteButton?.addEventListener("click", () => {
  const index = entries.findIndex(item => item.id === selectedId);
  if (index < 0) return;
  const entry = entries[index];
  transformControls?.detach();
  world.remove(entry.object);
  entries.splice(index, 1);
  selectEntry(entries.at(-1)?.id || null);
  if (!entries.length) {
    emptyHint.hidden = false;
    sceneFile.textContent = "No model loaded";
    projectLabel.textContent = "Untitled project";
  } else {
    sceneFile.textContent = entries.length + " model(s) loaded";
  }
  status.textContent = "Removed " + entry.name + " from the browser viewport (original file unchanged)";
});
fitButton?.addEventListener("click", () => {
  const entry = entries.find(item => item.id === selectedId);
  if (entry) fitCameraToObject(entry.object);
  else {
    controls.target.set(0, 0, 35);
    camera.position.set(330, -420, 310);
    controls.update();
  }
});
document.addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  if (event.key.toLowerCase() === "g") setTransformMode("translate");
  if (event.key.toLowerCase() === "r") setTransformMode("rotate");
  if (event.key.toLowerCase() === "s") setTransformMode("scale");
  if (event.key === "Delete" && !deleteButton.disabled) deleteButton.click();
});

function fitCameraToObject(object) {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const distance = Math.max(260, maxDim * 2.35);
  controls.target.copy(center);
  camera.position.set(center.x + distance * 0.78, center.y - distance, center.z + distance * 0.72);
  camera.near = Math.max(0.1, distance / 500);
  camera.far = Math.max(5000, distance * 20);
  camera.updateProjectionMatrix();
  controls.update();
}
function centerAndFit(object) {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.y -= center.y;
  object.position.z -= bounds.min.z;
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  fitCameraToObject(object);
}
function prepareMaterials(object) {
  object.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (!node.material) node.material = new THREE.MeshStandardMaterial({ color: "#c5cbd1", metalness: 0.12, roughness: 0.68 });
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if ("side" in material) material.side = THREE.DoubleSide;
      if ("emissive" in material) material.emissive.set(0x000000);
    }
    if (node.geometry && !node.geometry.attributes.normal) node.geometry.computeVertexNormals();
  });
}
async function parseModel(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  const buffer = await file.arrayBuffer();
  if (extension === "stl") {
    const geometry = new STLLoader().parse(buffer);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: "#c9d0d8", metalness: 0.12, roughness: 0.66 }));
  }
  if (extension === "obj") {
    const text = new TextDecoder().decode(buffer);
    return new OBJLoader().parse(text);
  }
  if (extension === "3mf") return new ThreeMFLoader().parse(buffer);
  throw new Error("Unsupported file type: " + extension);
}
async function addFiles(selected) {
  const incoming = Array.from(selected || []);
  for (const file of incoming) {
    const extension = file.name.split(".").pop().toLowerCase();
    if (!accepted.has(extension)) { status.textContent = file.name + ": unsupported file type"; continue; }
    if (file.size > MAX_FILE_BYTES) { status.textContent = file.name + ": exceeds 200 MB"; continue; }
    if (!rendererReady) { status.textContent = "WebGL is unavailable in this browser."; continue; }
    status.textContent = "Loading " + file.name + "…";
    try {
      const object = await parseModel(file);
      prepareMaterials(object);
      const entry = { id: crypto.randomUUID(), name: file.name, size: file.size, object, format: extension, file, modified: false };
      entries.push(entry);
      world.add(object);
      if (entries.length === 1) centerAndFit(object);
      else {
        const bounds = new THREE.Box3().setFromObject(object);
        const center = bounds.getCenter(new THREE.Vector3());
        object.position.x -= center.x;
        object.position.y -= center.y;
        object.position.z -= bounds.min.z;
      }
      emptyHint.hidden = true;
      selectEntry(entry.id);
      projectLabel.textContent = entries.length === 1 ? file.name : entries.length + " objects";
      sceneFile.textContent = entries.length + " model(s) loaded";
      status.textContent = "Loaded " + file.name + " · " + humanSize(file.size);
      sliceNote.textContent = "3D geometry loaded in the browser. Slicing is not connected yet; engine and printer profiles remain separate work.";
    } catch (error) {
      console.error(error);
      status.textContent = "Could not load " + file.name + ": " + error.message;
    }
  }
}
picker?.addEventListener("change", () => addFiles(picker.files));
scene?.addEventListener("dragover", event => { event.preventDefault(); scene.classList.add("drag-over"); });
scene?.addEventListener("dragleave", () => scene.classList.remove("drag-over"));
scene?.addEventListener("drop", event => {
  event.preventDefault();
  scene.classList.remove("drag-over");
  addFiles(event.dataTransfer?.files);
});
document.querySelectorAll(".tab[data-view]").forEach(tab => tab.addEventListener("click", () => {
  if (tab.disabled) return;
  document.querySelectorAll(".tab[data-view]").forEach(item => item.classList.toggle("active", item === tab));
}));

// Explicit opt-in, isolated development preview only; the public site never
// downloads or silently executes a WASM artifact.
if (new URLSearchParams(location.search).has("engineLab")) {
  import("./scripts/prepare-engine-lab.mjs").then(({installPrepareEngineLab}) =>
    installPrepareEngineLab({
      getSelection: () => entries.find(entry => entry.id === selectedId) ?? null,
      getEntries: () => [...entries],
      onStatus: message => { sliceNote.textContent = message; },
    })
  ).catch(error => {
    sliceNote.textContent = "Local engine lab could not initialize: " + error.message;
    console.error(error);
  });
}
