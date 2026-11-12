import { sliceStlWithEngine } from "./slice-stl.mjs";
// Browser-only development probe for local, user-selected WASM artifacts.
// No remote engine binaries are fetched; no project files are uploaded.
// API contract reference: pinned Hiosdra/OrcaWasm engine-binding.js.
export function checkIsolation(environment = globalThis) {
  return environment.crossOriginIsolated === true &&
    typeof environment.SharedArrayBuffer === "function";
}

export function validatePair(jsFile, wasmFile) {
  if (!jsFile || !wasmFile) throw new Error("Choose both slicer-mt.js and slicer-mt.wasm.");
  if (jsFile.name !== "slicer-mt.js" || wasmFile.name !== "slicer-mt.wasm")
    throw new Error("The selected files must be named slicer-mt.js and slicer-mt.wasm.");
  if (jsFile.size < 1000 || wasmFile.size < 100000)
    throw new Error("Engine files are unexpectedly small; check the artifact.");
}

export async function loadSelectedEngine(jsFile, wasmFile, environment = globalThis) {
  validatePair(jsFile, wasmFile);
  if (!checkIsolation(environment)) {
    throw new Error("This host is not cross-origin isolated; the pthread WASM engine cannot start safely.");
  }
  const source = await jsFile.text();
  const wasmBinary = new Uint8Array(await wasmFile.arrayBuffer());
  // The Emscripten MODULARIZE artifact is a classic IIFE with an external
  // OneSlicerEngine binding. Import it as a generated ES module, matching the
  // passing Node conformance harness. Pthreads use this URL to load the same
  // JS on their workers. The content comes only from the locally selected file.
  const code = source + "\nexport default OneSlicerEngine;\n";
  // Dynamic import needs ESM, but Emscripten's pthreads load their entrypoint
  // using importScripts(), which must remain a classic script (no export).
  const moduleUrl = URL.createObjectURL(new Blob([code], {type:"text/javascript"}));
  const workerUrl = URL.createObjectURL(new Blob([source], {type:"text/javascript"}));
  try {
    const {default: artifact} = await import(moduleUrl);
    if (!artifact || artifact.apiVersion !== "0.7.0" ||
        typeof artifact.createEngine !== "function") {
      throw new Error("Engine binding is not compatible with one-slicer-api 0.7.0.");
    }
    const engine = await artifact.createEngine({
      runtime: {
        wasmBinary,
        mainScriptUrlOrBlob: workerUrl,
        printErr: message => console.warn("[Orca WASM]", message),
        onAbort: reason => console.error("[Orca WASM abort]", reason),
      }
    });
    const capabilities = engine.capabilities;
    if (capabilities?.api?.version !== "0.7.0" ||
        capabilities?.engine?.family !== "OrcaSlicer" ||
        capabilities?.engine?.version !== "2.5.0") {
      throw new Error("Capabilities do not identify the pinned OrcaSlicer v2.5.0 API.");
    }
    // Keep blob URL alive for the lifetime of the engine: pthread workers
    // may need it after initial engine creation.
    return {
      capabilities,
      engine,
      release() {
        // Consumers must dispose all sessions before releasing the URL.
        URL.revokeObjectURL(moduleUrl);
        URL.revokeObjectURL(workerUrl);
      },
    };
  } catch (error) {
    URL.revokeObjectURL(moduleUrl);
    URL.revokeObjectURL(workerUrl);
    throw error;
  }
}

const button = document.querySelector("#probe");
const jsInput = document.querySelector("#engine-js");
const wasmInput = document.querySelector("#engine-wasm");
const output = document.querySelector("#probe-output");
const isolation = document.querySelector("#isolation");
const sliceInput = document.querySelector("#slice-stl");
const sliceButton = document.querySelector("#slice-model");
const sliceOutput = document.querySelector("#slice-output");
const downloadLink = document.querySelector("#download-gcode");
let loadedDiagnostic = null;
let lastDownloadUrl = null;

if (button && jsInput && wasmInput && output && isolation) {
  const supported = checkIsolation();
  isolation.textContent = supported
    ? "Cross-origin isolation: enabled; pthread loading is permitted."
    : "Cross-origin isolation: missing (COOP/COEP). This host cannot run the pthread engine.";
  const update = () => { button.disabled = !supported || !jsInput.files?.length || !wasmInput.files?.length; };
  jsInput.addEventListener("change", update);
  wasmInput.addEventListener("change", update);
  button.addEventListener("click", async () => {
    button.disabled = true;
    output.textContent = "Loading local WASM engine…";
    try {
      const result = await loadSelectedEngine(jsInput.files[0], wasmInput.files[0]);
      output.textContent = JSON.stringify(result.capabilities, null, 2);
      // Keep the runtime and worker URL alive for this diagnostic tab.
      // No slicing requests are issued from this page.
      window.__layerDiagnosticEngine = result;
      loadedDiagnostic = result;
      if (sliceInput?.files?.length) sliceButton.disabled = false;
    } catch (error) {
      output.textContent = "FAILED: " + error.message;
      update();
    }
  });
}

if (sliceInput && sliceButton && sliceOutput && downloadLink) {
  sliceInput.addEventListener("change", () => {
    sliceButton.disabled = !loadedDiagnostic || !sliceInput.files?.length;
  });
  sliceButton.addEventListener("click", async () => {
    sliceButton.disabled = true;
    downloadLink.hidden = true;
    if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
    lastDownloadUrl = null;
    sliceOutput.textContent = "Slicing selected STL in the locally loaded WASM engine…";
    try {
      const file = sliceInput.files?.[0];
      if (!file || !file.name.toLowerCase().endsWith(".stl") || file.size > 20 * 1024 * 1024)
        throw new Error("Choose an STL file smaller than 20 MB for this proof.");
      const input = new Uint8Array(await file.arrayBuffer());
      const { gcode, statistics } = await sliceStlWithEngine(
        loadedDiagnostic.engine,
        input,
        progress => { sliceOutput.textContent = "Slicing: " + (progress?.percent ?? "?") + "% · " + (progress?.stage ?? ""); },
      );
      lastDownloadUrl = URL.createObjectURL(new Blob([gcode], {type: "text/plain"}));
      downloadLink.href = lastDownloadUrl;
      downloadLink.hidden = false;
      sliceOutput.textContent = "PASS: G-code generated (" + gcode.byteLength + " bytes). Generic PLA test profile only. " +
        (statistics ? "Statistics: " + JSON.stringify(statistics).slice(0, 1200) : "");
    } catch (error) {
      sliceOutput.textContent = "FAILED: " + error.message;
    } finally {
      sliceButton.disabled = !loadedDiagnostic || !sliceInput.files?.length;
    }
  });
}
