// Viewer-only transform history; this does not edit native 3MF projects.
// Structural changes (import, duplicate, delete) must clear the stack.
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
    undo() {
      const item = undoStack.pop();
      if (!item) return null;
      redoStack.push(item);
      return { id: item.id, snapshot: cloneSnapshot(item.before) };
    },
    redo() {
      const item = redoStack.pop();
      if (!item) return null;
      undoStack.push(item);
      return { id: item.id, snapshot: cloneSnapshot(item.after) };
    },
  };
}
