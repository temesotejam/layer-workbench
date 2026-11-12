import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const accepted = new Set(["stl", "3mf", "obj"]);
const entries = [];
let selectedId = null;
let renderer, camera, controls, modelRoot;
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
  if (entry && entry.object) {
    entries.forEach(item => item.object?.traverse(node => {
      if (node.isMesh && node.material?.emissive) node.material.emissive.set(item.id === id ? 0x172b24 : 0x000000);
    }));
  }
}
function centerAndFit(object) {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.y -= center.y;
  object.position.z -= bounds.min.z;
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const distance = Math.max(260, maxDim * 2.35);
  controls.target.set(0, 0, Math.max(size.z * 0.42, 12));
  camera.position.set(distance * 0.78, -distance, distance * 0.72);
  camera.near = Math.max(0.1, distance / 500);
  camera.far = Math.max(5000, distance * 20);
  camera.updateProjectionMatrix();
  controls.update();
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
      const entry = { id: crypto.randomUUID(), name: file.name, size: file.size, object, format: extension };
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
      selectedId = entry.id;
      emptyHint.hidden = true;
      renderObjects();
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
