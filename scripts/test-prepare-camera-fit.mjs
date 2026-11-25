import test from 'node:test';
import assert from 'node:assert/strict';
import { perspectiveFitDistance, prepareViewOrientation } from './prepare-camera-fit.mjs';

test('Top fits tall thin bounds using the nearest face', () => {
  const s = {x:20,y:20,z:500};
  const d = perspectiveFitDistance(s,'top',38,1);
  assert.ok(d > 250);
  assert.ok(s.x/2/(d-s.z/2)/Math.tan(19*Math.PI/180) <= 0.8+1e-12);
});
test('Front accounts for depth and a narrow viewport', () => {
  const s = {x:200,y:400,z:20};
  const aspect = 0.15;
  const d = perspectiveFitDistance(s,'front',38,aspect);
  assert.ok(s.x/2/(d-s.y/2)/(Math.tan(19*Math.PI/180)*aspect) <= 0.8+1e-12);
});
test('3D portrait frustum contains the enclosing sphere', () => {
  const s = {x:220,y:180,z:100};
  const aspect = 0.3;
  const d = perspectiveFitDistance(s,'3d',38,aspect)*Math.hypot(.78,1,.72);
  const angle = Math.atan(Math.tan(19*Math.PI/180)*aspect);
  assert.ok(Math.hypot(s.x,s.y,s.z)/2 <= d*Math.sin(angle)/1.25+1e-10);
});
test('small boxes retain minimum distance; invalid input rejected', () => {
  assert.equal(perspectiveFitDistance({x:0,y:0,z:0},'top',38,1),120);
  assert.equal(perspectiveFitDistance({x:1,y:1,z:1},'3d',38,1),260);
  assert.throws(()=>perspectiveFitDistance({x:1,y:1,z:1},'front',38,0),RangeError);
  assert.throws(()=>perspectiveFitDistance({x:NaN,y:1,z:1},'top',38,1),RangeError);
});

test('side directions follow the source-pinned Z-up axes', () => {
  assert.deepEqual(prepareViewOrientation('left'), {offset:[-1,0,0],up:[0,0,1]});
  assert.deepEqual(prepareViewOrientation('right'), {offset:[1,0,0],up:[0,0,1]});
  assert.deepEqual(prepareViewOrientation('rear'), {offset:[0,1,0],up:[0,0,1]});
  assert.throws(()=>prepareViewOrientation('unknown'),RangeError);
});
test('side framing exchanges horizontal width and depth, rear matches front', () => {
  const s = {x:400,y:200,z:20};
  const aspect = .15;
  const frontEquivalent = perspectiveFitDistance({x:s.y,y:s.x,z:s.z},'front',38,aspect);
  for (const mode of ['left','right'])
    assert.equal(perspectiveFitDistance(s,mode,38,aspect), frontEquivalent);
  assert.equal(perspectiveFitDistance(s,'rear',38,aspect), perspectiveFitDistance(s,'front',38,aspect));
});
