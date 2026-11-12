const picker = document.querySelector("#model-file");
const status = document.querySelector("#file-status");
const tree = document.querySelector("#object-tree");
const projectLabel = document.querySelector("#project-label");
const sceneFile = document.querySelector("#scene-file");
const sliceNote = document.querySelector("#slice-note");
const scene = document.querySelector("#scene");

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const accepted = new Set(["stl", "3mf", "obj"]);
const files = [];

function humanSize(bytes) {
  return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(2) + " MB" : (bytes / 1024).toFixed(1) + " KB";
}

function renderObjects() {
  if (!files.length) {
    tree.innerHTML = '<div class="empty-object"><span class="cube-icon">◇</span><strong>No objects yet</strong><small>Import an STL, 3MF or OBJ file to begin.</small></div>';
    return;
  }
  tree.innerHTML = files.map((file, index) =>
    '<div class="object-item"><span class="object-glyph">◇</span><span class="object-name" title="' +
    escapeText(file.name) + '">' + escapeText(file.name) +
    '</span><span class="object-size">' + humanSize(file.size) + '</span></div>'
  ).join("");
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function addFiles(selected) {
  const incoming = Array.from(selected || []);
  if (!incoming.length) return;
  const acceptedFiles = [];
  const rejected = [];
  for (const file of incoming) {
    const extension = file.name.split(".").pop().toLowerCase();
    if (!accepted.has(extension)) {
      rejected.push(file.name + ": unsupported file type");
    } else if (file.size > MAX_FILE_BYTES) {
      rejected.push(file.name + ": exceeds 200 MB");
    } else {
      acceptedFiles.push(file);
    }
  }
  files.push(...acceptedFiles);
  renderObjects();
  if (acceptedFiles.length) {
    const first = acceptedFiles[0];
    projectLabel.textContent = first.name;
    sceneFile.textContent = acceptedFiles.length + " file(s) selected";
    status.textContent = acceptedFiles.length + " file(s) selected · " + acceptedFiles.map(f => f.name).join(", ");
    sliceNote.textContent = "Files are listed locally only. Geometry parsing, viewport loading and slicing are not connected yet.";
  }
  if (rejected.length) status.textContent += " · Rejected: " + rejected.join("; ");
}

picker?.addEventListener("change", () => addFiles(picker.files));
scene?.addEventListener("dragover", event => event.preventDefault());
scene?.addEventListener("drop", event => {
  event.preventDefault();
  addFiles(event.dataTransfer?.files);
});

document.querySelectorAll(".tab[data-view]").forEach(tab => {
  tab.addEventListener("click", () => {
    if (tab.disabled) return;
    document.querySelectorAll(".tab[data-view]").forEach(item => item.classList.toggle("active", item === tab));
  });
});
