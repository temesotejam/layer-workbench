const picker = document.querySelector("#model-file");
const status = document.querySelector("#file-status");
const zone = document.querySelector("#dropzone");

function showFile(file) {
  if (!file) return;
  const maxBytes = 200 * 1024 * 1024;
  if (file.size > maxBytes) {
    status.textContent = "File is larger than the current 200 MB preview limit.";
    return;
  }
  status.textContent = `Selected: ${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB · slicing is not available yet`;
}
picker?.addEventListener("change", () => showFile(picker.files?.[0]));
zone?.addEventListener("dragover", event => { event.preventDefault(); });
zone?.addEventListener("drop", event => {
  event.preventDefault();
  showFile(event.dataTransfer?.files?.[0]);
});
