'use strict';
// 2.8: rest timer — per-exercise length, state at a time, ±15.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const settings = { restMain: 180, restAcc: 90 };
const meso = () => ({ days: [{ exercises: [{ exId: 'a', type: 'main' }, { exId: 'b', type: 'accessory' }, { exId: 'c', type: 'accessory', rest: 45 }] }] });

test('restFor: the plan slot’s own rest, else the Settings default for its type', () => {
  const m = meso();
  assert.deepEqual([0, 1, 2].map(i => C.restFor(m, 0, i, settings)), [180, 90, 45]);
  assert.equal(C.restFor(m, 0, 9, settings), 90);
});

test('clampRest: 15 s steps, 15 s to 10 min', () => {
  assert.deepEqual([0, 7, 8, 15, 100, 135, 600, 615, 9999, -30, NaN].map(C.clampRest), [15, 15, 15, 15, 105, 135, 600, 600, 600, 15, 15]);
});

test('restState: running (seconds left, rounded up), over (seconds past zero), expired after 10 min', () => {
  const end = 100000;
  assert.deepEqual(C.restState({ end }, end - 61500), { state: 'running', secs: 62 });
  assert.deepEqual(C.restState({ end }, end), { state: 'over', secs: 0 });
  assert.deepEqual(C.restState({ end }, end + 12400), { state: 'over', secs: 12 });
  assert.deepEqual(C.restState({ end }, end + 599999), { state: 'over', secs: 599 });
  assert.equal(C.restState({ end }, end + 600000).state, 'expired');
  assert.equal(C.restState(null, 0).state, 'expired');
  assert.equal(C.restState({ end: 'x' }, 0).state, 'expired');
});

test('adjustRest: ±15 moves a running end, never into the past; +15 in overtime restarts from now', () => {
  const now = 50000;
  assert.equal(C.adjustRest(now + 60000, 15, now), now + 75000);
  assert.equal(C.adjustRest(now + 60000, -15, now), now + 45000);
  assert.equal(C.adjustRest(now + 10000, -15, now), now);       // ends now
  assert.equal(C.adjustRest(now - 20000, 15, now), now + 15000);  // overtime: 15 s from now
  assert.equal(C.adjustRest(now - 20000, -15, now), now);
});
