// Opt-in localhost /?engineLab=1: bridge the Prepare selection to the
// previously verified candidate, without deploying that binary to Pages.
// The proof accepts one STL plus checked native affine transforms; real profiles remain unimplemented.
import { loadSelectedEngine, checkIsolation } from "./probe-engine.mjs";
import { sliceMultiStlWithEngine } from "./slice-stl.mjs";
import {readTestProcessFile} from "./test-process-profile.mjs";
import {readProcessPresetBundle} from "./process-preset-inheritance.mjs";
import {readOrcaProfileCollection} from "./orca-profile-collection.mjs";
import {createLayerPreview} from "./gcode-layer-preview.mjs";

export function installPrepareEngineLab({getSelection, getEntries, onStatus}) {
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
    <label>Optional process overrides (.json, restricted test fields) <input id="lab-process" type="file" accept=".json"></label>
    <label>Orca-style process preset bundle (.json, supported fields only) <input id="lab-preset-bundle" type="file" accept=".json"></label>
    <label>Preset name <input id="lab-preset-name" type="text" maxlength="120" placeholder="e.g. Strong"></label>
    <label>Optional raw Orca machine/filament/process collection (.json) <input id="lab-orca-profiles" type="file" accept=".json"></label>
    <label>Machine preset name <input id="lab-orca-machine" type="text" maxlength="160"></label>
    <label>Filament preset name <input id="lab-orca-filament" type="text" maxlength="160"></label>
    <label>Process preset name <input id="lab-orca-process" type="text" maxlength="160"></label>
    <button id="lab-slice" disabled>Slice STL plate (test only)</button>
    <a id="lab-download" hidden download="prepare-test.gcode">Download test G-code</a>
    <p id="lab-status" role="status" aria-live="polite">No engine loaded.</p>
  `;
  panel.appendChild(root);
  const preview=createLayerPreview(root);
  const $ = sel => root.querySelector(sel);
  const js = $("#lab-js");
  const wasm = $("#lab-wasm");
  const load = $("#lab-load");
  const slice = $("#lab-slice");
  const processFile = $("#lab-process");
  const presetBundle = $("#lab-preset-bundle");
  const presetName = $("#lab-preset-name");
  const rawProfiles = $("#lab-orca-profiles");
  const rawMachine = $("#lab-orca-machine");
  const rawFilament = $("#lab-orca-filament");
  const rawProcess = $("#lab-orca-process");
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
    const entries = getEntries();
    slice.disabled = busy || !loaded || entries.length === 0 || entries.length > 24 ||
      entries.some(e => e.format !== "stl" || !e.file || e.file.size > 20 * 1024 * 1024) ||
      entries.reduce((sum,e)=>sum+e.file.size,0) > 80 * 1024 * 1024;
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
      onStatus("Local engine loaded. STL objects on one plate can be sliced using generic PLA test settings.");
    } catch (error) {
      status.textContent = "FAILED loading engine: " + error.message;
    } finally {
      busy = false;
      refresh();
    }
  });
  slice.addEventListener("click", async () => {
    const selected = getEntries();
    if (!loaded || selected.length === 0 || selected.length > 24 ||
        selected.some(e => e.format !== "stl" || !e.file)) {
      status.textContent = "This test supports up to 24 STL models on one plate.";
      return;
    }
    busy = true;
    refresh();
    download.hidden = true;
    preview.clear();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    status.textContent = "Slicing " + selected.length + " model(s)…";
    try {
      const models = await Promise.all(selected.map(async e => {
        e.object.updateMatrixWorld(true);
        return {
          bytes:new Uint8Array(await e.file.arrayBuffer()),
          viewerElements:Array.from(e.object.matrixWorld.elements),
        };
      }));
      if ([processFile.files?.length, presetBundle.files?.length, rawProfiles.files?.length].filter(Boolean).length>1)
        throw new Error("Use either the flat process fragment OR the inherited preset bundle, not both.");
      const nativeCollection = rawProfiles.files?.length
        ? await readOrcaProfileCollection(rawProfiles.files[0],{
          machine:rawMachine.value.trim(),filament:rawFilament.value.trim(),process:rawProcess.value.trim(),
        })
        : null;
      const chosenPreset = presetBundle.files?.length
        ? await readProcessPresetBundle(presetBundle.files[0],presetName.value.trim())
        : null;
      const processOverrides = nativeCollection?.process.settings ?? chosenPreset?.settings ?? await readTestProcessFile(processFile.files?.[0]);
      const result = await sliceMultiStlWithEngine(loaded.engine, models, progress => {
        status.textContent = "Slicing: " + (progress?.percent ?? "?") + "% · " + (progress?.stage ?? "");
      }, processOverrides, nativeCollection);
      downloadUrl = URL.createObjectURL(new Blob([result.gcode], {type: "text/plain"}));
      download.href = downloadUrl;
      download.hidden = false;
      let previewInfo = "";
      try {
        const pathData = preview.show(new TextDecoder().decode(result.gcode));
        previewInfo = " Preview: " + pathData.layers.length + " Z levels.";
      } catch (previewError) {
        previewInfo = " Preview unavailable: " + previewError.message;
      }
      const unsupported = nativeCollection
        ? [nativeCollection.machine,nativeCollection.filament,nativeCollection.process].reduce((n,v)=>n+v.unsupported.length,0) : 0;
      status.textContent = "PASS: " + selected.length + " STL model(s) → " + result.gcode.byteLength +
        " G-code bytes. Restricted test profiles with " + (nativeCollection ? "Orca raw preset selection ("+rawMachine.value+" / "+rawFilament.value+" / "+rawProcess.value+"), "+unsupported+" unsupported keys excluded" : chosenPreset ? "inherited process preset (" + chosenPreset.chain.join(" > ") + ")" : processOverrides ? "test overrides" : "default process") + ";" + previewInfo + " Do not print without validating.";
      onStatus("Test WASM sliced all imported STL models and their displayed transforms on one plate; generic PLA settings only.");
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
