import assert from "node:assert/strict";
import test from "node:test";
import {captureViewerTransform, createViewerTransformHistory} from "./prepare-viewer-transform-history.mjs";

const snapshot = (x, modified = false) => ({
  position: [x, 2, 3],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
  modified,
});

test("records numeric transforms, undo/redo, and discards redo after new edit", () => {
  const history = createViewerTransformHistory();
  assert.equal(history.canUndo(), false);
  assert.equal(history.record({id: "a", before: snapshot(0), after: snapshot(10, true)}), true);
  assert.deepEqual(history.undo(), {id: "a", snapshot: snapshot(0)});
  assert.equal(history.canRedo(), true);
  assert.deepEqual(history.redo(), {id: "a", snapshot: snapshot(10, true)});
  assert.deepEqual(history.undo(), {id: "a", snapshot: snapshot(0)});
  history.record({id: "a", before: snapshot(0), after: snapshot(5, true)});
  assert.equal(history.canRedo(), false);
  assert.equal(history.undo().snapshot.position[0], 0);
});

test("does not record unchanged snapshots or discard redo for no-op changes", () => {
  const h = createViewerTransformHistory();
  h.record({id: "a", before: snapshot(0), after: snapshot(10, true)});
  h.undo();
  assert.equal(h.record({id: "a", before: snapshot(0), after: snapshot(0)}), false);
  assert.equal(h.canRedo(), true);
});

test("stores independent snapshots and preserves quaternion, scale and modified", () => {
  const h = createViewerTransformHistory();
  const before = snapshot(0);
  const after = snapshot(0, true);
  after.quaternion = [0, 0, 0.707, 0.707];
  after.scale = [2, 0.5, 3];
  h.record({id: "rot", before, after});
  after.scale[0] = 100;
  assert.deepEqual(h.redo(), null);
  assert.deepEqual(h.undo(), {id: "rot", snapshot: before});
  assert.deepEqual(h.redo().snapshot.scale, [2, 0.5, 3]);
});

test("history is bounded, reset on structure changes, and tracks entry id", () => {
  const h = createViewerTransformHistory(2);
  for (let i = 0; i < 3; i++)
    h.record({id: String(i), before: snapshot(i), after: snapshot(i + 1, true)});
  assert.equal(h.undo().id, "2");
  assert.equal(h.undo().id, "1");
  assert.equal(h.undo(), null);
  h.clear();
  assert.equal(h.canRedo(), false);
  assert.equal(h.canUndo(), false);
});

test("invalid snapshots and invalid limit fail closed", () => {
  assert.throws(() => createViewerTransformHistory(0), RangeError);
  const h = createViewerTransformHistory();
  assert.throws(() => h.record({id: "bad", before: snapshot(0), after: snapshot(Infinity)}), TypeError);
  assert.equal(h.canUndo(), false);
  assert.throws(() => h.record({id: "bad", before: snapshot(0), after: {...snapshot(1), quaternion: [0,0,0]}}), TypeError);
});

test("loose-mesh duplication is reversible after transform edits", () => {
  const h = createViewerTransformHistory();
  h.recordDuplicate("copy");
  h.record({id:"copy", before:snapshot(20,true), after:snapshot(25,true)});
  assert.deepEqual(h.undo(), {id:"copy",snapshot:snapshot(20,true)});
  assert.deepEqual(h.undo(), {id:"copy",duplicateAction:"remove"});
  assert.equal(h.canUndo(), false);
  assert.deepEqual(h.redo(), {id:"copy",duplicateAction:"restore"});
  assert.deepEqual(h.redo(), {id:"copy",snapshot:snapshot(25,true)});
  assert.equal(h.canRedo(), false);
});

test("new edits and explicit clears invalidate a detached duplicate redo", () => {
  const h = createViewerTransformHistory();
  assert.throws(() => h.recordDuplicate(""), TypeError);
  assert.equal(h.canUndo(), false);
  h.recordDuplicate("copy");
  assert.deepEqual(h.undo(), {id:"copy",duplicateAction:"remove"});
  assert.equal(h.canRedo(), true);
  h.record({id:"original",before:snapshot(0),after:snapshot(10,true)});
  assert.equal(h.canRedo(), false);
  assert.deepEqual(h.undo(), {id:"original",snapshot:snapshot(0)});
  h.recordDuplicate("next");
  h.clear();
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
});

test("capture extracts independently owned Three.js-compatible arrays", () => {
  const entry = {modified: true, object: {
    position: {toArray: () => [1,2,3]},
    quaternion: {toArray: () => [0,0,0,1]},
    scale: {toArray: () => [1,1,1]},
  }};
  const a = captureViewerTransform(entry);
  a.position[0] = 100;
  assert.equal(captureViewerTransform(entry).position[0], 1);
});
