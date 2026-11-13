import {auditOrcaArrayOption} from "./orca-config-array-semantics.mjs";
// Source-preserving, non-executable OrcaSlicer profile inheritance resolver.
// Deliberately separate from the restricted WASM PrintConfig adapter: resolving
// a full preset NEVER authorizes a printer profile or G-code for real printing.
const KINDS = new Set(["machine", "filament", "process"]);
const META = new Set(["name", "type", "inherits"]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_RECORDS = 96;
const MAX_INHERITANCE = 20;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_COLLECTION_SIZE = 8192;

function isObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x) &&
    (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
}
function checkedName(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 160 || UNSAFE_KEYS.has(raw))
    throw new Error("Invalid Orca profile name");
  return raw;
}
function cloneJson(raw, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new Error("Orca profile JSON nesting exceeds limit");
  if (raw === null || typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (Array.isArray(raw)) {
    if (raw.length > MAX_COLLECTION_SIZE) throw new Error("Orca profile array exceeds limit");
    // Dense arrays only: sparse JS arrays cannot originate in valid JSON.
    return Array.from(raw, value => cloneJson(value, depth + 1));
  }
  if (isObject(raw)) {
    const pairs = Object.entries(raw);
    if (pairs.length > MAX_COLLECTION_SIZE) throw new Error("Orca profile object exceeds limit");
    const copy = Object.create(null);
    for (const [key, value] of pairs) {
      if (!key || UNSAFE_KEYS.has(key)) throw new Error("Unsafe Orca profile key: " + key);
      copy[key] = cloneJson(value, depth + 1);
    }
    return copy;
  }
  throw new Error("Non-JSON Orca profile value");
}
function checkedRecord(rec) {
  if (!isObject(rec) || !KINDS.has(rec.type)) throw new Error("Invalid Orca profile record type");
  checkedName(rec.name);
  if (rec.inherits != null && rec.inherits !== "") checkedName(rec.inherits);
  // Perform a bounded copy once, rejecting unsafe nested keys and non-JSON
  // values, while preserving arrays, scripts, metadata and unknown options.
  const copy = cloneJson(rec);
  const encoded = JSON.stringify(copy);
  if (encoded.length > MAX_JSON_BYTES) throw new Error("Orca profile record exceeds size limit");
  return copy;
}

export function resolveFullOrcaProfileFamily(records, type, selected) {
  if (!KINDS.has(type)) throw new Error("Invalid Orca family type");
  checkedName(selected);
  if (!Array.isArray(records) || !records.length || records.length > MAX_RECORDS)
    throw new Error("Invalid Orca profile collection size");
  const registry = new Map();
  for (const source of records) {
    const rec = checkedRecord(source);
    const key = rec.type + ":" + rec.name;
    if (registry.has(key)) throw new Error("Duplicate Orca profile record: " + key);
    registry.set(key, rec);
  }
  const chain = [], visiting = new Set();
  function visit(name, depth) {
    if (depth > MAX_INHERITANCE) throw new Error("Orca inheritance exceeds depth limit");
    const key = type + ":" + name;
    if (visiting.has(key)) throw new Error("Orca profile inheritance cycle: " + key);
    const rec = registry.get(key);
    if (!rec) throw new Error("Missing Orca profile ancestor: " + key);
    visiting.add(key);
    if (rec.inherits) visit(rec.inherits, depth + 1);
    chain.push(rec);
    visiting.delete(key);
  }
  visit(selected, 0);
  const settings = Object.create(null), sourceByKey = Object.create(null);
  for (const rec of chain) {
    for (const [key, value] of Object.entries(rec)) {
      if (META.has(key)) continue;
      // Later child values REPLACE whole parent values. In particular, arrays
      // are not concatenated or collapsed to element zero.
      settings[key] = cloneJson(value);
      sourceByKey[key] = rec.name;
    }
  }
  return {type, name:selected, chain:chain.map(r=>r.name), settings, sourceByKey,
    // No PrintConfig/WASM application and no execution of machine G-code.
    usableForPrinting:false};
}

export function inspectOrcaNozzleVector(machine) {
  if (!machine || machine.type !== "machine" || !machine.settings)
    throw new Error("Expected resolved Orca machine profile");
  const raw = machine.settings.nozzle_diameter;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16)
    throw new Error("Invalid or missing native nozzle_diameter vector");
  const diameters = raw.map(v => {
    if ((typeof v !== "string" && typeof v !== "number") ||
      !/^(?:\d+)(?:\.\d+)?$/.test(String(v)))
      throw new Error("Invalid native nozzle diameter");
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0.1 || n > 2.0)
      throw new Error("Native nozzle diameter outside inspection bounds");
    return n;
  });
  return {toolCount:diameters.length, nozzleDiametersMm:diameters,
    source:machine.sourceByKey.nozzle_diameter,
    supportedBySingleToolWasmAdapter:diameters.length === 1};
}

export function inspectOrcaArraySettings(profile) {
  if (!profile || !profile.settings || !profile.sourceByKey ||
      !profile.chain || !Array.isArray(profile.chain))
    throw new Error("Expected resolved full Orca profile");
  const arrays = Object.entries(profile.settings)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => ({
      ...auditOrcaArrayOption(key,value),
      source:profile.sourceByKey[key] ?? null,
      // Length match is informational only; ConfigDef semantics are authoritative.
      sameLengthAsNozzles: Array.isArray(profile.settings.nozzle_diameter) &&
        value.length === profile.settings.nozzle_diameter.length
    }))
    .sort((a,b)=>a.key.localeCompare(b.key));
  return {
    arraySettingCount:arrays.length,
    arrays,
    possiblePerToolVectors:arrays.filter(item=>item.sameLengthAsNozzles).map(item=>item.key),
    classification:"inspection-only; classified keys use pinned upstream ConfigDef sets"
  };
}
