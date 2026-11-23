// Viewer-only transform history; this does not edit native 3MF projects.
// Imports and native 3MF deletions clear history; loose STL/OBJ duplication and deletion are reversible.
const COMPONENTS = ["position", "quaternion", "scale"];

function cloneSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.modified !== "boolean" ||
      !COMPONENTS.every((key) =>
        Array.isArray(snapshot[key]) &&
        snapshot[key].length === (key === "quaternion" ? 4 : 3) &&
        snapshot[key].every(Number.isFinite))) {
    throw new TypeError("Expected a finite position/quaternion/scale snapshot");
  }
  return {
    position: [...snapshot.position],
    quaternion: [...snapshot.quaternion],
    scale: [...snapshot.scale],
    modified: snapshot.modified,
  };
}

export function captureViewerTransform(entry) {
  if (!entry?.object) throw new TypeError("Missing viewer object");
  return cloneSnapshot({
    position: entry.object.position.toArray(),
    quaternion: entry.object.quaternion.toArray(),
    scale: entry.object.scale.toArray(),
    modified: !!entry.modified,
  });
}

function equivalent(a, b) {
  return a.modified === b.modified && COMPONENTS.every((key) =>
    a[key].every((value, index) => Object.is(value, b[key][index])));
}

export function createViewerTransformHistory(limit = 50) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    throw new RangeError("History limit must be an integer from 1 to 500");
  const undoStack = [];
  const redoStack = [];
  return {
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
    record({ id, before, after }) {
      if (typeof id !== "string" || !id) throw new TypeError("Missing object id");
      const first = cloneSnapshot(before);
      const last = cloneSnapshot(after);
      if (equivalent(first, last)) return false;
      undoStack.push({ id, before: first, after: last });
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
      return true;
    },
    recordDuplicate(id) {
      if (typeof id !== "string" || !id) throw new TypeError("Missing duplicate id");
      undoStack.push({kind: "duplicate", id});
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
    },
    recordDelete(id) {
      if (typeof id !== "string" || !id) throw new TypeError("Missing deleted object id");
      undoStack.push({kind: "delete", id});
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
    },
    undo() {
      const item = undoStack.pop();
      if (!item) return null;
      redoStack.push(item);
      if (item.kind === "duplicate") return {id: item.id, duplicateAction: "remove"};
      if (item.kind === "delete") return {id: item.id, deleteAction: "restore"};
      return { id: item.id, snapshot: cloneSnapshot(item.before) };
    },
    redo() {
      const item = redoStack.pop();
      if (!item) return null;
      undoStack.push(item);
      if (item.kind === "duplicate") return {id: item.id, duplicateAction: "restore"};
      if (item.kind === "delete") return {id: item.id, deleteAction: "remove"};
      return { id: item.id, snapshot: cloneSnapshot(item.after) };
    },
  };
}
