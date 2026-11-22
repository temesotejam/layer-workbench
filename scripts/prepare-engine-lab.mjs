// Opt-in localhost /?engineLab=1: bridge the Prepare selection to the
// previously verified candidate, without deploying that binary to Pages.
// Mesh-only STL and OBJ (locally converted to STL); checked affine transforms.
// Native CAD/STEP, OBJ materials, and full printer profiles remain unsupported.
import { loadSelectedEngine, checkIsolation } from "./probe-engine.mjs";
import { sliceMultiStlWithEngine } from "./slice-stl.mjs";
import {readTestProcessFile} from "./test-process-profile.mjs";
import {readProcessPresetBundle} from "./process-preset-inheritance.mjs";
import {readOrcaProfileCollection} from "./orca-profile-collection.mjs";
import {createLayerPreview} from "./gcode-layer-preview.mjs";
import {objToBinaryStl} from "./obj-to-stl.mjs";
import {inspectNative3mf} from "./inspect-native-3mf.mjs";
import {MAX_WORLD_FACETS} from "./audit-native-3mf-world-facets.mjs";
import * as THREE from "three";

// Only the opt-in isolated viewer uses this bounded geometry witness. The
// importer applies a *translation-only* -128 mm root mapping. Undo exactly
// that mapping before comparing with native Core 3MF world millimeters.
// Reject edited/ambiguous roots or missing/oversized geometry; never transmit
// vertex data to UI text, logging or the published website.
function collectUnedited3mfWorldFacets(entries) {
  if (!Array.isArray(entries) || !entries.length ||
      entries.some(e=>e.modified || !e.sourceRoot || e.sourceRoot!==entries[0].sourceRoot))
    return null;
  const root=entries[0].sourceRoot;
  if (![root.position.x,root.position.y,root.position.z].every(Number.isFinite) ||
      [root.rotation.x,root.rotation.y,root.rotation.z].some(v=>Math.abs(v)>1e-8) ||
      [root.scale.x,root.scale.y,root.scale.z].some(v=>Math.abs(v-1)>1e-8))
    return null;
  const facets=[];
  const groups=[];
  try {
    root.updateMatrixWorld(true);
    for (const entry of entries) {
      const group=[];
      entry.object.traverse(node=>{
        if (!node.isMesh) return;
        const position=node.geometry?.getAttribute('position');
        const index=node.geometry?.index;
        const count=index?.count ?? position?.count;
        const draw=node.geometry?.drawRange;
        if (!position || position.itemSize!==3 || !Number.isSafeInteger(count) ||
            count<3 || count%3!==0 || facets.length+count/3>MAX_WORLD_FACETS ||
            (draw && (draw.start!==0 ||
             (Number.isFinite(draw.count) && draw.count<count))))
          throw new Error('Unsupported browser 3MF facet representation');
        for (let i=0;i<count;i+=3) {
          const triangle=[];
          for(let j=0;j<3;j++) {
            const vertex=index ? index.getX(i+j) : i+j;
            if (!Number.isSafeInteger(vertex) || vertex<0 || vertex>=position.count)
              throw new Error('Invalid 3MF browser vertex index');
            const p=new THREE.Vector3().fromBufferAttribute(position,vertex)
              .applyMatrix4(node.matrixWorld);
            triangle.push([p.x-root.position.x,p.y-root.position.y,p.z-root.position.z]);
          }
          facets.push(triangle);
          group.push(triangle);
        }
      });
      if (!group.length) throw new Error('Empty 3MF viewer build');
      groups.push(group);
    }
  } catch (_error) {return null;}
  return facets.length ? {facets,groups} : null;
}

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
    <label>Test bed mapping <select id="lab-orca-plate">
      <option value="none">No plate-specific mapping (fixture defaults)</option>
      <option value="hot">High Temp Plate (explicit)</option>
      <option value="cool">Cool Plate (explicit)</option>
      <option value="engineering">Engineering Plate (explicit)</option>
      <option value="textured">Textured PEI Plate (explicit)</option>
      <option value="textured-cool">Textured Cool Plate (explicit)</option>
      <option value="supertack">Supertack Plate (explicit)</option>
    </select></label>
    <label>Filament extruder variant (exact name, optional) <input id="lab-orca-filament-variant" type="text" maxlength="120" placeholder="Direct Drive Standard"></label>
    <small>Exact extruder variant selection is required for multi-value filament volumetric speed limits; without it no limit is guessed. Real printer extruder-type matching is not yet validated. Manufacturer scripts and generated G-code remain non-print-ready.</small>
    <small>An explicitly chosen plate selects one of six pinned OrcaSlicer v2.5.0 native bed-temperature key pairs; selection is never inferred. Unsupported or zero-temperature plate settings are refused, and first-layer values are forwarded only when present. This is an isolated development-only test, not printer-profile validation. Inherited first-layer nozzle temperature and bounded (0.5–1.5) single-filament flow ratio are forwarded as native vectors; isolated Chrome tests confirmed changes in actual M104 and G1 E commands. Multi-value flow ratios are rejected. Multi-value volumetric flow limits require an explicit, exact extruder-variant selection; real printer/nozzle compatibility is not verified. Manufacturer startup scripts, complete material settings and desktop G-code parity remain unverified; generated G-code is not print-ready.</small>
    <label>Process preset name <input id="lab-orca-process" type="text" maxlength="160"></label>
    <small>OBJ is locally triangulated to binary STL for this isolated test. Units are assumed millimeters; materials, UVs, groups and colors are not preserved. No STEP import, CAD edits or print-safety verification.</small>
    <button id="lab-inspect-3mf" disabled>Inspect selected native 3MF (read only)</button>
    <small>Local 3MF diagnostic only (8 MiB maximum). The WASM engine independently reads the original archive and returns manifest counts; no edit, native viewport sync or 3MF save is claimed. Unknown or incompatible projects are refused.</small>
    <button id="lab-slice" disabled>Slice STL/OBJ plate (test only)</button>
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
  const inspect = $("#lab-inspect-3mf");
  const processFile = $("#lab-process");
  const presetBundle = $("#lab-preset-bundle");
  const presetName = $("#lab-preset-name");
  const rawProfiles = $("#lab-orca-profiles");
  const rawMachine = $("#lab-orca-machine");
  const rawFilament = $("#lab-orca-filament");
  const rawVariant = $("#lab-orca-filament-variant");
  const rawPlate = $("#lab-orca-plate");
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
    inspect.disabled = busy || !loaded || getSelection()?.format !== "3mf";
    slice.disabled = busy || !loaded || entries.length === 0 || entries.length > 24 ||
      entries.some(e => !["stl","obj"].includes(e.format) || !e.file || e.file.size > 20 * 1024 * 1024) ||
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
      onStatus("Local engine loaded. STL/OBJ triangle meshes can be sliced on one plate using generic PLA test settings.");
    } catch (error) {
      status.textContent = "FAILED loading engine: " + error.message;
    } finally {
      busy = false;
      refresh();
    }
  });
  inspect.addEventListener("click", async () => {
    const selected = getSelection();
    if (!loaded || selected?.format !== "3mf" || !selected.file) return;
    busy = true;
    refresh();
    status.textContent = "Inspecting selected original 3MF in native WASM (read only)…";
    try {
      // Three.js matrixWorld uses column-major storage; only take the
      // translation anchor, not the mesh or arbitrary model metadata.
      // No native ID↔browser ID matching is implied by this diagnostic.
      const selectedEntries = getEntries().filter(entry =>
        entry.format === "3mf" && entry.file === selected.file);
      const viewerMatrices = [];
       const viewerAnchors = selectedEntries.map(entry => {
        entry.object.updateMatrixWorld(true);
        const m = Array.from(entry.object.matrixWorld.elements);
        viewerMatrices.push(m);
        return [m[12],m[13],m[14]];
      });
      const geometry=collectUnedited3mfWorldFacets(selectedEntries);
      const report = await inspectNative3mf(loaded.engine, selected.file, {
        viewerAnchors,viewerMatrices,viewerFacets:geometry?.facets??null,
        viewerFacetGroups:geometry?.groups??null,
      });
      const visible = selectedEntries.length;
      const countMatch = visible === report.instances;
      status.textContent = "Native 3MF read-only import: " + report.objects + " objects, " +
        report.instances + " instances, " + report.meshes + " meshes, " + report.plates +
        " plates. Browser build items: " + visible + ". " +
        (countMatch ? "Counts agree (transforms and settings NOT verified)." :
          "COUNT MISMATCH: do not assume native/viewer hierarchy matches.") +
        " Native manifest relations: IDs " + report.relations.ids +
        ", links " + report.relations.references + ", affine matrices " +
        report.relations.affineMatrices + ". Native/viewer anchor spacing: " +
        report.placement.spacing + " (" + report.placement.comparedPairs +
        " pairs). Native/viewer linear parts: " + report.linear.linear +
        " (" + report.linear.comparedInstances + " instances)." +
        " Native/viewer affine frame offsets: " + report.frameOffsets.frame +
        " (" + report.frameOffsets.comparedInstances + " uniquely matched instances)." +
        " Shared native mesh local-origin hypothesis: " + report.sharedMeshReframe.reframe +
        " (" + report.sharedMeshReframe.comparedInstances + " matched shared-mesh instances; not proof)." +
        " Native-converted/viewer world facets: " + report.worldFacets.facets +
        " (" + report.worldFacets.comparedTriangles + " triangles)." +
        " Viewer build-facet partition: " + report.worldGroups.partition +
        " (" + report.worldGroups.comparedBuilds + " viewer builds)." +
        " Flattened geometry only; no native instance correspondence." +
        " Imported metadata, edits and native viewport synchronization unverified." +
        " No edit, export or print approval.";
      onStatus("Local WASM imported the original 3MF for a read-only hierarchy diagnostic. " +
        "The displayed Three.js scene is still independent of the native engine.");
    } catch (_error) {
      status.textContent = "Native 3MF inspection FAILED: unsupported, malformed or oversized project. " +
        "The browser model was not changed.";
    } finally {
      busy = false;
      refresh();
    }
  });
  slice.addEventListener("click", async () => {
    const selected = getEntries();
    if (!loaded || selected.length === 0 || selected.length > 24 ||
        selected.some(e => !["stl","obj"].includes(e.format) || !e.file)) {
      status.textContent = "This test supports up to 24 STL or OBJ meshes on one plate; STEP must be converted separately.";
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
          bytes:e.format === "stl"
            ? new Uint8Array(await e.file.arrayBuffer())
            : objToBinaryStl(new TextDecoder("utf-8",{fatal:true}).decode(await e.file.arrayBuffer())),
          viewerElements:Array.from(e.object.matrixWorld.elements),
        };
      }));
      if ([processFile.files?.length, presetBundle.files?.length, rawProfiles.files?.length].filter(Boolean).length>1)
        throw new Error("Use either the flat process fragment OR the inherited preset bundle, not both.");
      // Never silently fall back to the generic fixture when the UI explicitly
      // requests an Orca bed; it would ignore the selected heater profile.
      if (rawPlate.value!=="none" && !rawProfiles.files?.length)
        throw new Error("Explicit bed selection requires a raw Orca profile collection.");
      const nativeCollection = rawProfiles.files?.length
        ? await readOrcaProfileCollection(rawProfiles.files[0],{
          machine:rawMachine.value.trim(),filament:rawFilament.value.trim(),process:rawProcess.value.trim(),
        }, {plateType:rawPlate.value==="none" ? undefined : rawPlate.value,
          filamentVariant:rawVariant.value.trim() || undefined})
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
      const bedInfo = nativeCollection?.filament.selectedBed;
      const speedVariant = nativeCollection?.filament.selectedFilamentVariant;
      const unsupported = nativeCollection
        ? [nativeCollection.machine,nativeCollection.filament,nativeCollection.process].reduce((n,v)=>n+v.unsupported.length,0) : 0;
      status.textContent = "PASS: " + selected.length + " " +
        (selected.every(e=>e.format==="stl") ? "STL model(s)" : "STL/OBJ mesh model(s)") +
        " → " + result.gcode.byteLength +
        " G-code bytes. Restricted test profiles with " + (nativeCollection ? "Orca raw preset selection ("+rawMachine.value+" / "+rawFilament.value+" / "+rawProcess.value+"), "+unsupported+" unsupported keys excluded"+(bedInfo ? ", explicitly mapped "+bedInfo.plateType+" bed "+bedInfo.bed_temperature+" °C"+(bedInfo.initialLayerTemperature!==null ? " and native first-layer "+bedInfo.plateType+" bed "+bedInfo.initialLayerTemperature+" °C" : " (first layer unspecified)") : "") : chosenPreset ? "inherited process preset (" + chosenPreset.chain.join(" > ") + ")" : processOverrides ? "test overrides" : "default process") + ";" + previewInfo + " Do not print without validating.";
      if(speedVariant) console.log("Selected native volumetric limit:",speedVariant);
      onStatus("Test WASM sliced imported STL/OBJ geometry and displayed transforms on one plate; generic PLA settings only.");
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
