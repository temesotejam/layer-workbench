// Opt-in localhost /?engineLab=1: bridge the Prepare selection to the
// previously verified candidate, without deploying that binary to Pages.
// IMPORTANT: this proof accepts one unmodified source STL only.
import { loadSelectedEngine, checkIsolation } from "./probe-engine.mjs";
import { sliceStlWithEngine } from "./slice-stl.mjs";

export function installPrepareEngineLab({getSelection, onStatus}) {
  const panel = document.querySelector(".slice-area");
  if (!panel) throw new Error("Prepare slice panel not found.");
  const root = document.createElement("section");
  root.className = "engine-lab";
  root.innerHTML = `
    <h3>Local WASM slicing test</h3>
    <p id="lab-isolation"></p>
    <label>Verified slicer-mt.js <input id="lab-js" type="file" accept=".js"></label>
    <label>Verified slicer-mt.wasm <input id="lab-wasm" type="file" accept=".wasm"></label>
    <button id="lab-load" disabled>Load local engine</button>
    <button id="lab-slice" disabled>Slice selected STL (test only)</button>
    <a id="lab-download" hidden download="prepare-test.gcode">Download test G-code</a>
    <p id="lab-status" role="status" aria-live="polite">No engine loaded.</p>
  `;
  panel.appendChild(root);
  const $ = sel => root.querySelector(sel);
  const js = $("#lab-js");
  const wasm = $("#lab-wasm");
  const load = $("#lab-load");
  const slice = $("#lab-slice");
  const download = $("#lab-download");
  const status = $("#lab-status");
  const isolated = checkIsolation();
  $("#lab-isolation").textContent = isolated
    ? "Cross-origin isolated localhost: enabled."
    : "Requires localhost with COOP/COEP headers; disabled on GitHub Pages.";
  let loaded = null;
  let downloadUrl = null;
  let busy = false;
  const refresh = () => {
    load.disabled = busy || !isolated || !js.files?.length || !wasm.files?.length || !!loaded;
    const chosen = getSelection();
    slice.disabled = busy || !loaded || !chosen || chosen.format !== "stl" ||
      chosen.modified || !chosen.file || chosen.file.size > 20 * 1024 * 1024;
  };
  js.addEventListener("change", refresh);
  wasm.addEventListener("change", refresh);
  const selectionObserver = new MutationObserver(refresh);
  selectionObserver.observe(document.querySelector("#object-tree"), {childList:true, subtree:true});
  // Observe user-visible transform updates as well as object selection changes.
  const transformObserver = new MutationObserver(refresh);
  transformObserver.observe(document.querySelector("#transform-status"), {childList:true, characterData:true, subtree:true});
  load.addEventListener("click", async () => {
    busy = true;
    refresh();
    status.textContent = "Starting local OrcaSlicer WASM…";
    try {
      loaded = await loadSelectedEngine(js.files[0], wasm.files[0]);
      status.textContent = "Ready: " + loaded.capabilities.engine.family + " " + loaded.capabilities.engine.version;
      onStatus("Local test engine loaded. Select an unmodified STL to test slicing; generic PLA only.");
    } catch (error) {
      status.textContent = "FAILED loading engine: " + error.message;
    } finally {
      busy = false;
      refresh();
    }
  });
  slice.addEventListener("click", async () => {
    const chosen = getSelection();
    if (!loaded || !chosen || chosen.format !== "stl" || chosen.modified) {
      status.textContent = "Only an unmodified source STL can be sliced in this test.";
      return;
    }
    busy = true;
    refresh();
    download.hidden = true;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    status.textContent = "Slicing " + chosen.name + "…";
    try {
      const raw = new Uint8Array(await chosen.file.arrayBuffer());
      const result = await sliceStlWithEngine(loaded.engine, raw, progress => {
        status.textContent = "Slicing: " + (progress?.percent ?? "?") + "% · " + (progress?.stage ?? "");
      });
      downloadUrl = URL.createObjectURL(new Blob([result.gcode], {type: "text/plain"}));
      download.href = downloadUrl;
      download.hidden = false;
      status.textContent = "PASS: " + chosen.name + " → " + result.gcode.byteLength +
        " G-code bytes. Generic PLA test profile only; do not print without validating.";
      onStatus("WASM generated test G-code from the selected original STL; native project transforms remain unsupported.");
    } catch (error) {
      status.textContent = "FAILED slicing: " + error.message;
    } finally {
      busy = false;
      refresh();
    }
  });
  refresh();
  return {refresh};
}
