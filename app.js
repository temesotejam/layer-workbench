import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { automaticViewProjection, orthographicFitHalfHeight, perspectiveFitDistance, prepareViewOrientation } from "./scripts/prepare-camera-fit.mjs";
import { get3mfViewportBuildItems } from "./scripts/three-mf-viewport-items.mjs";
import { captureViewerTransform, createViewerTransformHistory } from "./scripts/prepare-viewer-transform-history.mjs";
import { findViewerSpace, arrangeViewerSpaces, findViewerSpaceWithQuarterTurn, arrangeViewerSpacesWithQuarterTurns } from "./scripts/prepare-find-space.mjs";

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
const duplicateButton = document.querySelector("#duplicate-object");
const dropToBedButton = document.querySelector("#drop-to-bed");
const centerOnBedButton = document.querySelector("#center-on-bed");
const checkPlacementButton = document.querySelector("#check-placement");
const findSpaceButton = document.querySelector("#find-space");
const findSpaceRotateButton = document.querySelector("#find-space-rotate");
const arrangeAllButton = document.querySelector("#arrange-all");
const arrangeAllRotateButton = document.querySelector("#arrange-all-rotate");
const placementStatus = document.querySelector("#placement-status");
const undoButton = document.querySelector("#undo-viewer");
const redoButton = document.querySelector("#redo-viewer");
const fitButton = document.querySelector("#fit-view");
const fitAllButton = document.querySelector("#fit-all-view");
const viewButtons = [...document.querySelectorAll("[data-view-orientation]")];
const viewDirectionLabel = document.querySelector("#view-direction-label");
const projectionButton = document.querySelector("#toggle-projection");
const autoProjectionButton = document.querySelector("#auto-projection");
const projectionLabel = document.querySelector("#projection-label");
const transformStatus = document.querySelector("#transform-status");
const objectCount = document.querySelector("#object-count");
const transformInputs = Object.fromEntries(["x","y","z","rx","ry","rz","sx","sy","sz"].map(key =>
  [key, document.querySelector("#transform-" + key)]
));
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const accepted = new Set(["stl", "3mf", "obj"]);
// Native 3MF scenes use an absolute plate-origin coordinate system. The public
// app retains its original viewer-only auto-centering until tested full 3MF
// semantics exist. This diagnostic mapping is opt-in on isolated localhost.
const isolated3mfViewportLab = (location.hostname === "localhost" ||
  location.hostname === "127.0.0.1") &&
  globalThis.crossOriginIsolated === true &&
  new URLSearchParams(location.search).get("engineLab") === "1";
const entries = [];
let selectedId = null;
let renderer, camera, controls, transformControls;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;
let rendererReady = false;
let currentView = "3d";
let automaticProjection = false;
let preventAutomaticPerspective = false;
const perspectiveFov = 38;
let canvasAspect = 1;
let orthoHalfHeight = 100;
let orthoFitAspect = 1;
const viewerHistory = createViewerTransformHistory(50);
// Keep a detached duplicate only while the matching Redo action is reachable.
// No native 3MF or source file is ever modified by this viewer-only cache.
const detachedViewerDuplicates = new Map();
// A removed loose STL/OBJ entry stays here only while its delete action is undoable.
const detachedViewerDeletions = new Map();
let dragStart = null;

const world = new THREE.Scene();
world.background = new THREE.Color("#20252c");
world.fog = new THREE.Fog("#20252c", 900, 2200);
camera = new THREE.PerspectiveCamera(perspectiveFov, 1, 0.1, 5000);
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
  new THREE.MeshStandardMaterial({ color: "#353c45", roughness: 0.88, metalness: 0.05, side: THREE.FrontSide })
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
  controls = makeOrbitControls(new THREE.Vector3(0, 0, 35));
  transformControls = new TransformControls(camera, renderer.domElement);
  world.add(transformControls.getHelper());
  transformControls.addEventListener("dragging-changed", event => {
    controls.enabled = !event.value;
    const entry = entries.find(item => item.id === selectedId);
    if (event.value) {
      dragStart = entry ? {id: entry.id, before: captureViewerTransform(entry)} : null;
    } else {
      if (entry && dragStart?.id === entry.id) recordViewerEdit(entry, dragStart.before);
      dragStart = null;
      updateTransformStatus();
    }
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
    canvasAspect = width / height;
    updateCameraProjection();
    renderer.setSize(width, height);
  });
  resizeObserver.observe(canvasHost);
  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    // The opaque bed is front-facing only. Keep its outline from below, but
    // do not draw the grid in front of the model underside.
    grid.visible = camera.position.z >= grid.position.z;
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
  // Browser-only duplication is deliberately limited to loose mesh files.
  // Complex 3MF projects require native instance/volume semantics first.
  duplicateButton.disabled = !entry || !["stl", "obj"].includes(entry.format) || !!entry.sourceRoot;
  dropToBedButton.disabled = !entry || !["stl", "obj"].includes(entry.format) || !!entry.sourceRoot;
  centerOnBedButton.disabled = dropToBedButton.disabled;
  checkPlacementButton.disabled = dropToBedButton.disabled;
  findSpaceButton.disabled = dropToBedButton.disabled || entries.length > 64 ||
    !entries.every(item => !item.sourceRoot && ["stl", "obj"].includes(item.format));
  findSpaceRotateButton.disabled = findSpaceButton.disabled;
  arrangeAllButton.disabled = entries.length < 2 || entries.length > 64 ||
    !entries.every(item => !item.sourceRoot && ["stl", "obj"].includes(item.format));
  arrangeAllRotateButton.disabled = arrangeAllButton.disabled || entries.length > 6;
  entries.forEach(item => item.object?.traverse(node => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach(material => {
      if (material?.emissive) material.emissive.set(item.id === id ? 0x172b24 : 0x000000);
    });
  }));
  updateTransformStatus();
}

// Undo/redo applies viewer transforms and loose STL/OBJ duplicate/delete only;
// it never changes source files or native 3MF projects.
function updateViewerHistoryButtons() {
  undoButton.disabled = !viewerHistory.canUndo();
  redoButton.disabled = !viewerHistory.canRedo();
}
function clearViewerHistory() {
  viewerHistory.clear();
  detachedViewerDuplicates.clear();
  detachedViewerDeletions.clear();
  dragStart = null;
  updateViewerHistoryButtons();
}
function recordViewerEdit(entry, before) {
  if (!entry || !before) return;
  const changed = viewerHistory.record({id: entry.id, before, after: captureViewerTransform(entry)});
  // A new edit invalidates Redo, including any detached duplicate it owned.
  // Keep deleted objects: an earlier deletion may still be reachable via Undo.
  if (changed) detachedViewerDuplicates.clear();
  updateViewerHistoryButtons();
}
function updateViewerProjectHeader() {
  emptyHint.hidden = entries.length > 0;
  projectLabel.textContent = entries.length === 0 ? "Untitled project" :
    entries.length === 1 ? entries[0].name : entries.length + " objects";
  sceneFile.textContent = entries.length === 0 ? "No model loaded" :
    entries.length + " model(s) loaded";
}
// Detach/restore imported browser scene entries without serializing them.
// A 3MF build item remains attached to its original ThreeMFLoader root on
// Undo, preserving its nested geometry and transforms. No native 3MF edit.
function detachViewerEntry(entry, index) {
  const root = entry.sourceRoot;
  let childIndex = null;
  if (root) {
    childIndex = root.children.indexOf(entry.object);
    if (childIndex < 0) return null;
    entry.object.removeFromParent();
    if (!entries.some((item, i) => i !== index && item.sourceRoot === root))
      world.remove(root);
  } else {
    world.remove(entry.object);
  }
  entries.splice(index, 1);
  return {entry, index, childIndex};
}
function restoreDetachedViewerEntry(saved) {
  if (saved.entry.sourceRoot) {
    const root = saved.entry.sourceRoot;
    if (saved.entry.object.parent) return false;
    root.add(saved.entry.object);
    // Undo may restore a build item ahead of existing siblings.
    const children = root.children;
    children.splice(children.indexOf(saved.entry.object), 1);
    children.splice(Math.max(0, Math.min(saved.childIndex, children.length)), 0, saved.entry.object);
    if (root.parent !== world) world.add(root);
  } else {
    if (saved.entry.object.parent) return false;
    world.add(saved.entry.object);
  }
  entries.splice(Math.min(saved.index, entries.length), 0, saved.entry);
  return true;
}
function restoreViewerHistory(step) {
  if (!step) return;
  if (step.deleteAction) {
    if (step.deleteAction === "restore") {
      const saved = detachedViewerDeletions.get(step.id);
      if (!saved || entries.some(item => item.id === step.id)) {
        clearViewerHistory();
        return;
      }
      if (!restoreDetachedViewerEntry(saved)) {
        clearViewerHistory();
        return;
      }
      detachedViewerDeletions.delete(step.id);
      selectEntry(saved.entry.id);
      status.textContent = "Undid browser-only deletion of " + saved.entry.name +
        " (original file unchanged)";
    } else if (step.deleteAction === "remove") {
      const index = entries.findIndex(item => item.id === step.id);
      const entry = entries[index];
      if (!entry || !["stl", "obj", "3mf"].includes(entry.format)) {
        clearViewerHistory();
        return;
      }
      transformControls?.detach();
      const detached = detachViewerEntry(entry, index);
      if (!detached) {
        clearViewerHistory();
        return;
      }
      detachedViewerDeletions.set(entry.id, detached);
      selectEntry(entries.at(-1)?.id ?? null);
      status.textContent = "Redid browser-only deletion of " + entry.name +
        " (original file unchanged)";
    } else {
      clearViewerHistory();
      return;
    }
    updateViewerProjectHeader();
    updateViewerHistoryButtons();
    return;
  }
  if (step.duplicateAction) {
    if (step.duplicateAction === "remove") {
      const index = entries.findIndex(item => item.id === step.id);
      const duplicate = entries[index];
      if (!duplicate || duplicate.sourceRoot || !["stl","obj"].includes(duplicate.format)) {
        clearViewerHistory();
        return;
      }
      transformControls?.detach();
      world.remove(duplicate.object);
      entries.splice(index, 1);
      detachedViewerDuplicates.set(duplicate.id, {entry: duplicate, index});
      selectEntry(entries.at(-1)?.id ?? null);
      status.textContent = "Undid browser-only duplication of " + duplicate.name +
        " (original file unchanged)";
    } else if (step.duplicateAction === "restore") {
      const saved = detachedViewerDuplicates.get(step.id);
      if (!saved || entries.some(item => item.id === step.id)) {
        clearViewerHistory();
        return;
      }
      entries.splice(Math.min(saved.index, entries.length), 0, saved.entry);
      world.add(saved.entry.object);
      detachedViewerDuplicates.delete(step.id);
      selectEntry(saved.entry.id);
      status.textContent = "Redid browser-only duplication of " + saved.entry.name +
        " (original file unchanged)";
    } else {
      clearViewerHistory();
      return;
    }
    updateViewerProjectHeader();
    updateViewerHistoryButtons();
    return;
  }
  if (step.batch) {
    const targets = step.batch.map(s => entries.find(item => item.id === s.id));
    if (targets.some(item => !item || item.sourceRoot || !["stl","obj"].includes(item.format))) {
      clearViewerHistory();
      return;
    }
    step.batch.forEach(({snapshot}, i) => {
      const entry = targets[i];
      entry.object.position.fromArray(snapshot.position);
      entry.object.quaternion.fromArray(snapshot.quaternion);
      entry.object.scale.fromArray(snapshot.scale);
      entry.object.updateMatrixWorld(true);
      entry.modified = snapshot.modified;
    });
    updateTransformStatus();
    updateViewerHistoryButtons();
    status.textContent = "Restored viewer-only arrangement (original files unchanged)";
    return;
  }
  const entry = entries.find(item => item.id === step.id);
  if (!entry) {
    clearViewerHistory();
    return;
  }
  entry.object.position.fromArray(step.snapshot.position);
  entry.object.quaternion.fromArray(step.snapshot.quaternion);
  entry.object.scale.fromArray(step.snapshot.scale);
  entry.object.updateMatrixWorld(true);
  entry.modified = step.snapshot.modified;
  selectEntry(entry.id);
  updateViewerHistoryButtons();
  status.textContent = "Restored viewer-only transform for " + entry.name +
    " (original file unchanged)";
}
undoButton?.addEventListener("click", () => restoreViewerHistory(viewerHistory.undo()));
redoButton?.addEventListener("click", () => restoreViewerHistory(viewerHistory.redo()));

function updateTransformStatus() {
  placementStatus.textContent = "Check the selected mesh against the viewer plate and other mesh bounds.";
  const entry = entries.find(item => item.id === selectedId);
  const looseMesh = entry && !entry.sourceRoot && ["stl", "obj"].includes(entry.format);
  for (const [key, input] of Object.entries(transformInputs)) {
    input.disabled = !entry || (["rx", "ry"].includes(key) && !looseMesh);
  }
  if (entry) {
    const p = entry.object.position, r = entry.object.rotation, sc = entry.object.scale;
    const values = {x:p.x, y:p.y, z:p.z, rx:THREE.MathUtils.radToDeg(r.x), ry:THREE.MathUtils.radToDeg(r.y), rz:THREE.MathUtils.radToDeg(r.z), sx:sc.x, sy:sc.y, sz:sc.z};
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
    const before = captureViewerTransform(entry);
    if (["x","y","z"].includes(key)) entry.object.position[key] = value;
    if (["rx","ry","rz"].includes(key)) {
      if (input.disabled) return;
      entry.object.rotation[key.slice(1)] = THREE.MathUtils.degToRad(value);
    }
    if (["sx","sy","sz"].includes(key)) entry.object.scale[key.slice(1)] = value;
    entry.object.updateMatrixWorld(true);
    entry.modified = true;
    recordViewerEdit(entry, before);
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
  // Even for a 3MF build item this only detaches the displayed Three.js
  // object, never edits the source archive, instance manifest or WASM session.
  clearViewerHistory();
  transformControls?.detach();
  const detached = detachViewerEntry(entry, index);
  if (!detached) {
    status.textContent = "Cannot remove an inconsistent 3MF build item.";
    return;
  }
  detachedViewerDeletions.set(entry.id, detached);
  viewerHistory.recordDelete(entry.id);
  selectEntry(entries.at(-1)?.id || null);
  updateViewerProjectHeader();
  updateViewerHistoryButtons();
  status.textContent = "Removed " + entry.name + " from the browser viewport (original file unchanged) · Undo available";
});
// Clone a loose STL/OBJ scene entry for local layout experiments only.
// Share immutable mesh buffers for efficiency, but keep material instances
// independent so selection highlights cannot leak between copies.
duplicateButton?.addEventListener("click", () => {
  const source = entries.find(item => item.id === selectedId);
  if (!rendererReady || !source || source.sourceRoot || !["stl", "obj"].includes(source.format)) return;
  clearViewerHistory();
  const copy = source.object.clone(true);
  copy.traverse(node => {
    if (!node.isMesh) return;
    if (Array.isArray(node.material)) {
      node.material = node.material.map(material => material?.clone?.() ?? material);
    } else if (node.material?.clone) {
      node.material = node.material.clone();
    }
  });
  copy.position.x += 20;
  copy.position.y += 20;
  copy.updateMatrixWorld(true);
  const duplicate = {
    id: crypto.randomUUID(), name: source.name + " (copy)", size: source.size,
    object: copy, format: source.format, file: source.file, modified: true
  };
  world.add(copy);
  entries.push(duplicate);
  selectEntry(duplicate.id);
  viewerHistory.recordDuplicate(duplicate.id);
  updateViewerHistoryButtons();
  projectLabel.textContent = entries.length + " objects";
  sceneFile.textContent = entries.length + " model(s) loaded";
  status.textContent = "Duplicated " + source.name +
    " in browser viewport only (20 mm X/Y offset; no native project change)";
});
// Adjust only the selected loose mesh's viewer transform so that its actual
// transformed geometry touches the logical bed surface at world Z=0. This is
// not a native arrangement operation and never modifies the original file.
// 3MF items remain unavailable until native project placement is supported.
dropToBedButton?.addEventListener("click", () => {
  const entry = entries.find(item => item.id === selectedId);
  if (!rendererReady || transformControls.dragging || !entry || entry.sourceRoot || !["stl", "obj"].includes(entry.format)) return;
  entry.object.updateMatrixWorld(true);
  // Transform actual geometry vertices, not the corners of the cached local AABB.
  const bounds = new THREE.Box3().setFromObject(entry.object, true);
  if (bounds.isEmpty() || !Number.isFinite(bounds.min.z)) {
    status.textContent = "Cannot place model: its geometry bounds are invalid.";
    return;
  }
  const dz = -bounds.min.z;
  if (!Number.isFinite(dz) || Math.abs(dz) > 5000) {
    status.textContent = "Cannot place model: vertical correction is out of bounds.";
    return;
  }
  if (Math.abs(dz) < 1e-9) {
    status.textContent = entry.name + " already touches viewer bed Z=0";
    return;
  }
  const before = captureViewerTransform(entry);
  entry.object.position.z += dz;
  entry.object.updateMatrixWorld(true);
  entry.modified = true;
  recordViewerEdit(entry, before);
  updateTransformStatus();
  status.textContent = "Dropped " + entry.name +
    " to viewer bed Z=0 (browser only; original file unchanged)";
});
// Center the selected loose mesh's transformed world bounds in XY only.
// The browser plate is centered at world (0,0); this is not collision-aware
// arrangement, a native 3MF operation or a source-file edit.
centerOnBedButton?.addEventListener("click", () => {
  const entry = entries.find(item => item.id === selectedId);
  if (!rendererReady || transformControls.dragging || !entry || entry.sourceRoot ||
      !["stl", "obj"].includes(entry.format)) return;
  entry.object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(entry.object, true);
  const center = bounds.getCenter(new THREE.Vector3());
  const dx = plate.position.x - center.x, dy = plate.position.y - center.y;
  if (bounds.isEmpty() || ![dx,dy].every(v => Number.isFinite(v) && Math.abs(v) <= 5000)) {
    status.textContent = "Cannot center model: its geometry bounds or correction are invalid.";
    return;
  }
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    status.textContent = entry.name + " already centered on viewer plate";
    return;
  }
  const before = captureViewerTransform(entry);
  entry.object.position.x += dx;
  entry.object.position.y += dy;
  entry.object.updateMatrixWorld(true);
  entry.modified = true;
  recordViewerEdit(entry, before);
  updateTransformStatus();
  status.textContent = "Centered " + entry.name +
    " in viewer plate XY (browser only; original file unchanged; overlaps not checked)";
});
// Explicit, read-only layout check: no per-frame traversal or native state changes.
// The fixed viewer plane is not a printer profile. AABB overlap is only a broad-phase hint.
checkPlacementButton.addEventListener("click", () => {
  const selected = entries.find(item => item.id === selectedId);
  if (!rendererReady || transformControls.dragging || !selected || checkPlacementButton.disabled) return;
  const loose = item => !item.sourceRoot && ["stl", "obj"].includes(item.format);
  if (entries.length > 64 || !entries.every(loose)) {
    placementStatus.textContent = "Check unavailable: only up to 64 loose STL/OBJ meshes are supported.";
    return;
  }
  const boundsFor = item => {
    item.object.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(item.object, true);
  };
  const boxes = entries.map(boundsFor);
  if (boxes.some(b => b.isEmpty() || ![...b.min.toArray(), ...b.max.toArray()].every(Number.isFinite))) {
    placementStatus.textContent = "Check unavailable: invalid geometry bounds.";
    return;
  }
  const own = boxes[entries.indexOf(selected)];
  const eps = 1e-6;
  const halfX = plate.geometry.parameters.width / 2, halfY = plate.geometry.parameters.height / 2;
  const outside = own.min.x < plate.position.x - halfX - eps || own.max.x > plate.position.x + halfX + eps ||
    own.min.y < plate.position.y - halfY - eps || own.max.y > plate.position.y + halfY + eps;
  const overlap = boxes.filter(b => b !== own &&
    Math.min(b.max.x, own.max.x) - Math.max(b.min.x, own.min.x) > eps &&
    Math.min(b.max.y, own.max.y) - Math.max(b.min.y, own.min.y) > eps).length;
  const z = own.min.z < -eps ? "below bed" : own.min.z > eps ? "above bed" : "touches bed";
  placementStatus.textContent = (outside ? "Outside viewer plate" : "Within viewer plate XY") +
    " · " + z + " · XY bounding-box overlaps: " + overlap +
    " · Not a collision or printability check.";
});
// Move only the selected loose mesh. Rotation is an explicit fallback.
function findSelectedSpace(allowRotation) {
  const entry = entries.find(item => item.id === selectedId);
  if (!rendererReady || transformControls.dragging || !entry || findSpaceButton.disabled) return;
  try {
    const bounds = entries.map(item => {
      item.object.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(item.object, true);
      return [b.min.x, b.min.y, b.max.x, b.max.y];
    });
    const own = bounds.splice(entries.indexOf(entry), 1)[0];
    const hx = plate.geometry.parameters.width / 2, hy = plate.geometry.parameters.height / 2;
    const target = [plate.position.x-hx, plate.position.y-hy, plate.position.x+hx, plate.position.y+hy];
    // Loose meshes are direct children of the identity world scene. The
    // analytic world-Z rotation is not valid for an arbitrary parent frame.
    if (allowRotation && entry.object.parent !== world) return;
    const result = allowRotation ? findViewerSpaceWithQuarterTurn(own, bounds, target,
      [entry.object.position.x, entry.object.position.y]) : findViewerSpace(own, bounds, target);
    if (!result) {
      status.textContent = allowRotation ? "No free viewer AABB placement even with +90° Z rotation; nothing moved." :
        "No free viewer AABB placement with 5 mm clearance; nothing moved.";
      return;
    }
    const {dx,dy,quarterTurn = false} = result;
    if (![entry.object.position.x+dx, entry.object.position.y+dy, dx, dy]
        .every(v => Number.isFinite(v) && Math.abs(v) <= 5000)) {
      status.textContent = "Cannot move model: viewer correction out of bounds.";
      return;
    }
    if (!quarterTurn && Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
      status.textContent = "Selected mesh already has 5 mm viewer AABB clearance.";
      return;
    }
    const before = captureViewerTransform(entry);
    if (quarterTurn) entry.object.rotateOnWorldAxis(new THREE.Vector3(0,0,1), Math.PI/2);
    entry.object.position.x += dx;
    entry.object.position.y += dy;
    entry.object.updateMatrixWorld(true);
    entry.modified = true;
    recordViewerEdit(entry, before);
    updateTransformStatus();
    status.textContent = quarterTurn ? "Rotated selected mesh +90° Z and moved to free viewer AABB space (5 mm clearance; not printability)." :
      "Moved selected mesh to free viewer AABB space (5 mm clearance; not printability).";
  } catch (error) {
    status.textContent = "Find space unavailable: " + error.message;
  }
}
findSpaceButton.addEventListener("click", () => findSelectedSpace(false));
findSpaceRotateButton.addEventListener("click", () => findSelectedSpace(true));
// Plan every transform first; a failed plan leaves the entire scene unchanged.
function arrangeAllViewerMeshes(allowRotation) {
  if (!rendererReady || transformControls.dragging || arrangeAllButton.disabled ||
      (allowRotation && arrangeAllRotateButton.disabled)) return;
  try {
    const bounds = entries.map(item => {
      item.object.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(item.object, true);
      return [b.min.x, b.min.y, b.max.x, b.max.y];
    });
    const hx = plate.geometry.parameters.width / 2, hy = plate.geometry.parameters.height / 2;
    const target = [plate.position.x-hx, plate.position.y-hy, plate.position.x+hx, plate.position.y+hy];
    if (allowRotation && entries.some(item=>item.object.parent !== world)) return;
    const moves = allowRotation ? arrangeViewerSpacesWithQuarterTurns(bounds,target,
      entries.map(item=>[item.object.position.x,item.object.position.y])) : arrangeViewerSpaces(bounds,target);
    if (!moves) {
      status.textContent = allowRotation ? "No complete greedy viewer arrangement even with +90° turns; nothing moved." :
        "No complete greedy viewer arrangement; nothing moved.";
      return;
    }
    const edits = [];
    for (const [i, {dx,dy,quarterTurn=false}] of moves.entries()) {
      if (!quarterTurn && Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
      const entry = entries[i], before = captureViewerTransform(entry);
      const position = [before.position[0]+dx, before.position[1]+dy, before.position[2]];
      if (![dx,dy,...position.slice(0,2)].every(v => Number.isFinite(v) && Math.abs(v)<=5000)) {
        status.textContent = "Arrangement correction out of bounds; nothing moved.";
        return;
      }
      const quaternion = quarterTurn ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2)
        .multiply(new THREE.Quaternion().fromArray(before.quaternion)).toArray() : before.quaternion;
      edits.push({id:entry.id,before,after:{...before,position,quaternion,modified:true},entry});
    }
    if (!edits.length) {
      status.textContent = "All meshes already have 5 mm viewer AABB clearance.";
      return;
    }
    viewerHistory.recordBatch(edits);
    detachedViewerDuplicates.clear();
    for (const {entry,after} of edits) {
      entry.object.position.fromArray(after.position);
      entry.object.quaternion.fromArray(after.quaternion);
      entry.object.updateMatrixWorld(true);
      entry.modified = true;
    }
    updateTransformStatus();
    updateViewerHistoryButtons();
    status.textContent = moves.some(move=>move.quarterTurn) ? "Arranged all loose meshes with +90° turns (5 mm viewer AABB clearance; not printability)." :
      "Arranged all loose meshes (5 mm viewer AABB clearance; not printability).";
  } catch (error) {
    status.textContent = "Arrange all unavailable: " + error.message;
  }
}
arrangeAllButton.addEventListener("click", () => arrangeAllViewerMeshes(false));
arrangeAllRotateButton.addEventListener("click", () => arrangeAllViewerMeshes(true));
// These are real browser-camera controls, independent of the experimental WASM
// engine. They change only the view; they never change object coordinates.
function showView(mode) {
  if (!rendererReady || transformControls.dragging || !viewButtons.some(button => button.dataset.viewOrientation === mode)) return;
  currentView = mode;
  if (automaticProjection) {
    const next = automaticViewProjection(mode, camera.isOrthographicCamera, preventAutomaticPerspective);
    preventAutomaticPerspective = next.hold;
    setCameraProjection(next.orthographic);
  }
  viewDirectionLabel.textContent = viewButtons.find(button => button.dataset.viewOrientation === mode).textContent;
  viewButtons.forEach(button => {
    const active = button.dataset.viewOrientation === mode;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  fitCameraToAll();
}
viewButtons.forEach(button =>
  button.addEventListener("click", () => showView(button.dataset.viewOrientation))
);
fitButton?.addEventListener("click", () => {
  if (!rendererReady) return;
  const entry = entries.find(item => item.id === selectedId);
  if (entry) fitCameraToObject(entry.object);
  else placeCamera(new THREE.Vector3(0, 0, 35), 420);
});
fitAllButton?.addEventListener("click", fitCameraToAll);
function setCameraProjection(ortho) {
  if (Boolean(camera.isOrthographicCamera) === ortho) return;
  camera = ortho
    ? new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 5000)
    : new THREE.PerspectiveCamera(perspectiveFov, canvasAspect, 0.1, 5000);
  // The picker uses the active camera variable; the transform gizmo has its own
  // camera property. Both must follow the renderer on a projection switch.
  transformControls.camera = camera;
  projectionButton.setAttribute("aria-pressed", String(ortho));
  projectionLabel.textContent = ortho ? "Orthographic" : "Perspective";
}
projectionButton?.addEventListener("click", () => {
  if (!rendererReady || transformControls.dragging) return;
  preventAutomaticPerspective = true;
  setCameraProjection(!camera.isOrthographicCamera);
  fitCameraToAll();
});
autoProjectionButton?.addEventListener("click", () => {
  if (!rendererReady || transformControls.dragging) return;
  automaticProjection = !automaticProjection;
  autoProjectionButton.setAttribute("aria-pressed", String(automaticProjection));
  // Like the desktop preference, this affects subsequent direction choices.
  // Do not reframe, change selection or edit model state when toggling it.
});
document.addEventListener("keydown", event => {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) ||
    document.activeElement?.isContentEditable;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !typing) {
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) redoButton.click();
      else undoButton.click();
      return;
    }
    if (key === "y" && !event.shiftKey) {
      event.preventDefault();
      redoButton.click();
      return;
    }
  }
  if (event.ctrlKey || event.metaKey || event.altKey || typing) return;
  if (event.key.toLowerCase() === "g") setTransformMode("translate");
  if (event.key.toLowerCase() === "r") setTransformMode("rotate");
  if (event.key.toLowerCase() === "s") setTransformMode("scale");
  if (event.key === "Delete" && !deleteButton.disabled) deleteButton.click();
});

function makeOrbitControls(center) {
  // OrbitControls r180 caches the camera-up quaternion at construction.
  // Recreate it for a different camera or up axis, not merely swap .object.
  const position = camera.position.clone();
  const orbit = new OrbitControls(camera, renderer.domElement);
  camera.position.copy(position);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.075;
  orbit.target.copy(center);
  orbit.minDistance = 25;
  orbit.maxDistance = Math.max(1800, position.distanceTo(center) * 1.1);
  orbit.minZoom = 0.05;
  orbit.maxZoom = 50;
  orbit.update();
  return orbit;
}
function updateCameraProjection() {
  if (camera.isOrthographicCamera) {
    // Keep both fitted axes visible if the viewport becomes narrower.
    const h = orthoHalfHeight * Math.max(1, orthoFitAspect / canvasAspect);
    camera.top = h;
    camera.bottom = -h;
    camera.left = -h * canvasAspect;
    camera.right = h * canvasAspect;
  } else {
    camera.aspect = canvasAspect;
  }
  camera.updateProjectionMatrix();
}
function placeCamera(center, distance, halfHeight) {
  if (transformControls.dragging) return;
  const {offset, up} = prepareViewOrientation(currentView);
  const nextUp = new THREE.Vector3(...up);
  const replaceOrbit = controls.object !== camera || !camera.up.equals(nextUp);
  camera.up.copy(nextUp);
  camera.position.set(center.x + distance * offset[0],
                      center.y + distance * offset[1],
                      center.z + distance * offset[2]);
  camera.near = Math.max(0.1, distance / 500);
  camera.far = Math.max(5000, distance * 20);
  if (camera.isOrthographicCamera) {
    orthoHalfHeight = halfHeight ?? orthographicFitHalfHeight({x:256,y:256,z:0}, currentView, canvasAspect);
    orthoFitAspect = canvasAspect;
    camera.zoom = 1;
  }
  updateCameraProjection();
  camera.lookAt(center);
  if (replaceOrbit) {
    controls.dispose();
    controls = makeOrbitControls(center);
  } else {
    controls.target.copy(center);
    controls.maxDistance = Math.max(1800, camera.position.distanceTo(center) * 1.1);
    controls.update();
  }
}
function fitCameraToObject(object) {
  if (!rendererReady) return;
  fitCameraToBounds(new THREE.Box3().setFromObject(object));
}
function fitCameraToAll() {
  if (!rendererReady) return;
  const bounds = new THREE.Box3();
  for (const entry of entries) {
    bounds.union(new THREE.Box3().setFromObject(entry.object));
  }
  if (bounds.isEmpty()) placeCamera(new THREE.Vector3(0, 0, 35), 420);
  else fitCameraToBounds(bounds);
}
function fitCameraToBounds(bounds) {
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const distance = perspectiveFitDistance(size, currentView, perspectiveFov, canvasAspect);
  const halfHeight = camera.isOrthographicCamera
    ? orthographicFitHalfHeight(size, currentView, canvasAspect)
    : undefined;
  placeCamera(center, distance, halfHeight);
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
      // Imported geometry changes the selection/scene topology; do not replay old edits.
      clearViewerHistory();
      if (extension === "3mf" && isolated3mfViewportLab) {
        // ThreeMFLoader r180 creates one root child per 3MF <build> item.
        // Preserve its nested component transforms and original archive bytes.
        // This only separates browser selection, NOT native project objects.
        const parts = get3mfViewportBuildItems(object);
        object.position.x -= 128;
        object.position.y -= 128;
        object.updateMatrixWorld(true);
        const partEntries = parts.map(({object:part, buildIndex}) => ({
          id:crypto.randomUUID(), name:file.name + " · build " + buildIndex,
          size:file.size, object:part, sourceRoot:object, buildIndex,
          format:extension, file, modified:false,
        }));
        world.add(object);
        entries.push(...partEntries);
        if (entries.length === partEntries.length) fitCameraToObject(object);
        emptyHint.hidden = true;
        selectEntry(partEntries[0].id);
      } else {
        const entry = {id:crypto.randomUUID(),name:file.name,size:file.size,object,format:extension,file,modified:false};
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
      }
      projectLabel.textContent = entries.length === 1 ? file.name : entries.length + " objects";
      sceneFile.textContent = entries.length + " model(s) loaded";
      status.textContent = "Loaded " + file.name + " · " + humanSize(file.size) +
        (extension === "3mf" && isolated3mfViewportLab
          ? " · isolated 3MF build-item selection (viewer only; no native edit/save)"
          : "");
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
if (isolated3mfViewportLab) {
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

// Isolated localhost + explicit opt-in only: a read-only viewport diagnostic
// for CI to compare Three.js geometry with the archive's 3MF build placement.
// This does not expose files or enable native editing on the public site.
if (isolated3mfViewportLab) {
  Object.defineProperty(globalThis, "__layer3mfViewportAudit", {
    value: () => entries.filter(entry => entry.format === "3mf").map(entry => {
      entry.object.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(entry.object);
      let meshes = 0;
      entry.object.traverse(node => { if (node.isMesh) meshes++; });
      return {
        name: entry.name, meshCount: meshes,
        buildIndex: entry.buildIndex ?? null,
        viewerPosition: (entry.sourceRoot ?? entry.object).position.toArray(),
        buildWorldPosition: entry.object.getWorldPosition(new THREE.Vector3()).toArray(),
        boundsMm: {min: bounds.min.toArray(), max: bounds.max.toArray()},
        mode: "isolated-3mf-plate-origin-only",
      };
    }),
    writable: false, configurable: false,
  });
}
