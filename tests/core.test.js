'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadFrom, normalize, validate, freshState } = require('../core.js');

const RAW = fs.readFileSync(path.join(__dirname, 'fixtures', 'v1-sample.json'), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));

// Everything the user logged: per session its date/done and every set exactly as stored.
const logged = s => s.mesos.flatMap(m => Object.entries(m.log).map(([k, ss]) => ({
  meso: m.id, k, date: ss.date, done: ss.done, sets: ss.slots.map(sl => sl.sets),
})));

test('v1 fixture loads with every logged set and date unchanged', () => {
  const r = loadFrom(RAW);
  assert.ok(r.state, 'expected a state');
  assert.deepEqual(logged(r.state), logged(JSON.parse(RAW)));
});

test('v1 fixture: legacy rest becomes restAcc, missing defaults are filled, plan arrays untouched', () => {
  const r = loadFrom(RAW);
  assert.equal(r.changed, true);
  assert.equal(r.state.settings.restMain, 180);
  assert.equal(r.state.settings.restAcc, 120);
  assert.equal(r.state.mesos[0].style, 'rp');
  assert.equal(r.state.mesos[1].style, 'fixed');
  assert.deepEqual(r.state.mesos[0].log['0-1'].slots[0].fb, {});
  assert.deepEqual(r.state.mesos[0].days[0].exercises[0].plan, [2, null, 3]);
  assert.equal(r.state.mesos[0].log['0-1'].slots[0].sets[0].w, '0');
});

test('normalize is idempotent', () => {
  const s = JSON.parse(RAW);
  assert.equal(normalize(s), true);
  const once = clone(s);
  assert.equal(normalize(s), false);
  assert.deepEqual(s, once);
});

test('normalize reports no change for an already complete state', () => {
  assert.equal(normalize(freshState()), false);
});

test('missing settings loads with defaults', () => {
  const r = loadFrom(JSON.stringify({ v: 1, exercises: [], mesos: [] }));
  assert.ok(r.state);
  assert.deepEqual(r.state.settings, { unit: 'kg', restMain: 180, restAcc: 90 });
});

test('missing exercises/mesos arrays are backfilled, not rejected', () => {
  const r = loadFrom(JSON.stringify({ v: 1 }));
  assert.ok(r.state);
  assert.deepEqual(r.state.exercises, []);
  assert.deepEqual(r.state.mesos, []);
});

test('corrupt JSON → recovery', () => {
  assert.deepEqual(loadFrom('{"v":1,"mesos":['), { recovery: 'corrupt' });
  assert.deepEqual(loadFrom(''), { recovery: 'corrupt' });
});

test('not an object or no numeric v → recovery', () => {
  assert.deepEqual(loadFrom('{}'), { recovery: 'unknown' });
  assert.deepEqual(loadFrom('[]'), { recovery: 'unknown' });
  assert.deepEqual(loadFrom('"hello"'), { recovery: 'unknown' });
  assert.deepEqual(loadFrom('null'), { recovery: 'unknown' });
  assert.deepEqual(loadFrom('{"v":"1"}'), { recovery: 'unknown' });
});

test('newer version → read-only, data not altered in a way that loses anything', () => {
  const raw = JSON.stringify({ ...JSON.parse(RAW), v: 2 });
  const r = loadFrom(raw);
  assert.ok(r.readOnly);
  assert.equal(r.state, undefined);
  assert.equal(r.readOnly.v, 2);
  assert.deepEqual(logged(r.readOnly), logged(JSON.parse(raw)));
});

test('null (first run) → fresh state', () => {
  const r = loadFrom(null);
  assert.ok(r.state);
  assert.equal(r.state.v, 1);
  assert.ok(r.state.exercises.length > 0);
  assert.deepEqual(r.state.mesos, []);
});

test('validate rejects a session without slots', () => {
  const s = JSON.parse(RAW);
  normalize(s);
  assert.equal(validate(s), true);
  delete s.mesos[1].log['1-0'].slots;
  assert.equal(validate(s), false);
  const bad = JSON.parse(RAW);
  delete bad.mesos[0].log['0-0'].slots;
  assert.deepEqual(loadFrom(JSON.stringify(bad)), { recovery: 'invalid' });
});

test('validate rejects wrong types instead of overwriting them', () => {
  assert.deepEqual(loadFrom(JSON.stringify({ v: 1, settings: 'x', exercises: [], mesos: [] })), { recovery: 'invalid' });
  assert.deepEqual(loadFrom(JSON.stringify({ v: 1, exercises: [], mesos: {} })), { recovery: 'invalid' });
});
