'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadFrom, normalize, validate, freshState, loadState, summarize, importInto, KEY, BACKUP_KEY, RECOVERY_PREFIX, BEFORE_IMPORT_KEY } = require('../core.js');

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
  assert.deepEqual(loadFrom('{"v":0,"exercises":[],"mesos":[]}'), { recovery: 'unknown' });
  assert.deepEqual(loadFrom('{"v":0.5,"exercises":[],"mesos":[]}'), { recovery: 'unknown' });
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

/* ---------- loadState(storage, now) with an in-memory storage ---------- */

// Records every write so tests can assert which keys were touched.
function fakeStorage(init = {}, { throwOnGet = false } = {}) {
  const m = new Map(Object.entries(init));
  const writes = [];
  return {
    writes,
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => { if (throwOnGet) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { writes.push(k); m.set(k, String(v)); },
    dump: () => Object.fromEntries(m),
  };
}
const NOW = Date.UTC(2026, 10, 15, 9, 30);

test('loadState ok: backup-auto equals raw when normalize changed something; KEY not written', () => {
  const st = fakeStorage({ [KEY]: RAW });
  const r = loadState(st, NOW);
  assert.equal(r.mode, 'ok');
  assert.ok(r.state.mesos.length === 2);
  assert.deepEqual(st.writes, [BACKUP_KEY]);
  assert.equal(st.dump()[BACKUP_KEY], RAW);
  assert.equal(st.dump()[KEY], RAW);
});

test('loadState ok: no backup-auto when normalize changed nothing', () => {
  const s = JSON.parse(RAW); normalize(s);
  const st = fakeStorage({ [KEY]: JSON.stringify(s) });
  assert.equal(loadState(st, NOW).mode, 'ok');
  assert.deepEqual(st.writes, []);
});

test('loadState first run: fresh state, nothing written', () => {
  const st = fakeStorage();
  const r = loadState(st, NOW);
  assert.equal(r.mode, 'ok');
  assert.equal(r.state.v, 1);
  assert.deepEqual(st.writes, []);
});

test('loadState recovery: KEY never written, copy kept and de-duplicated across loads', () => {
  const bad = '{"v":1,"mesos":[oops';
  const st = fakeStorage({ [KEY]: bad });
  const r1 = loadState(st, NOW);
  assert.equal(r1.mode, 'recovery');
  assert.equal(r1.reason, 'corrupt');
  assert.equal(r1.copied, true);
  assert.equal(r1.raw, bad);
  const r2 = loadState(st, NOW + 60000);
  assert.equal(r2.mode, 'recovery');
  assert.equal(r2.copied, true);
  const copies = Object.keys(st.dump()).filter(k => k.startsWith(RECOVERY_PREFIX));
  assert.deepEqual(copies, [RECOVERY_PREFIX + new Date(NOW).toISOString()]);
  assert.equal(st.dump()[copies[0]], bad);
  assert.ok(!st.writes.includes(KEY));
  assert.equal(st.dump()[KEY], bad);
});

test('loadState recovery: a different unreadable value gets its own copy', () => {
  const st = fakeStorage({ [KEY]: '{oops' });
  loadState(st, NOW);
  st.setItem(KEY, '{oops2'); st.writes.length = 0;
  loadState(st, NOW + 1000);
  assert.equal(Object.keys(st.dump()).filter(k => k.startsWith(RECOVERY_PREFIX)).length, 2);
  assert.ok(!st.writes.includes(KEY));
});

test('loadState recovery: copy failure is reported, KEY still untouched', () => {
  const st = fakeStorage({ [KEY]: '{oops' });
  st.setItem = (k) => { st.writes.push(k); throw new Error('QuotaExceededError'); };
  const r = loadState(st, NOW);
  assert.equal(r.mode, 'recovery');
  assert.equal(r.copied, false);
  assert.ok(!st.writes.includes(KEY));
  assert.equal(st.dump()[KEY], '{oops');
});

test('loadState readOnly (v:2): nothing written, raw returned for export', () => {
  const raw = JSON.stringify({ ...JSON.parse(RAW), v: 2 });
  const st = fakeStorage({ [KEY]: raw });
  const r = loadState(st, NOW);
  assert.equal(r.mode, 'readOnly');
  assert.equal(r.raw, raw);
  assert.deepEqual(st.writes, []);
});

test('loadState storage error: recovery with reason storage, nothing written', () => {
  const st = fakeStorage({ [KEY]: RAW }, { throwOnGet: true });
  const r = loadState(st, NOW);
  assert.equal(r.mode, 'recovery');
  assert.equal(r.reason, 'storage');
  assert.equal(r.raw, null);
  assert.deepEqual(st.writes, []);
});

/* ---------- summarize / importInto ---------- */

test('summarize counts blocks, only done workouts, and the latest date', () => {
  const s = JSON.parse(RAW); normalize(s);
  // Fixture: meso1 has 3 done sessions, meso2 has 2 done + 1 unfinished.
  assert.deepEqual(summarize(s), { blocks: 2, workouts: 5, last: 1760400000000 });
  assert.deepEqual(summarize(freshState()), { blocks: 0, workouts: 0, last: null });
});

const CURRENT = JSON.stringify({ ...freshState(), activeId: 'current-data' });
const yes = () => true;

test('importInto fixture: normalized state, sets and dates unchanged, backup written before KEY', () => {
  const st = fakeStorage({ [KEY]: CURRENT });
  let seen;
  const r = importInto(st, RAW, sum => { seen = sum; return true; });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, { blocks: 2, workouts: 5, last: 1760400000000 });
  assert.deepEqual(logged(r.state), logged(JSON.parse(RAW)));
  assert.equal(r.state.settings.restAcc, 120);
  assert.deepEqual(st.writes, [BEFORE_IMPORT_KEY, KEY]);
  assert.equal(st.dump()[BEFORE_IMPORT_KEY], CURRENT);
  assert.deepEqual(JSON.parse(st.dump()[KEY]), r.state);
});

test('importInto: the before-import slot is overwritten on each import', () => {
  const st = fakeStorage({ [KEY]: CURRENT });
  importInto(st, RAW, yes);
  const afterFirst = st.dump()[KEY];
  importInto(st, RAW, yes);
  assert.equal(st.dump()[BEFORE_IMPORT_KEY], afterFirst);
  assert.equal(Object.keys(st.dump()).filter(k => k === BEFORE_IMPORT_KEY).length, 1);
});

test('importInto: missing settings → defaults', () => {
  const st = fakeStorage({ [KEY]: CURRENT });
  const r = importInto(st, JSON.stringify({ v: 1, exercises: [], mesos: [] }), yes);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.settings, { unit: 'kg', restMain: 180, restAcc: 90 });
});

test('importInto rejects corrupt, newer, wrong-version and shape-invalid files without writing', () => {
  const bad = JSON.parse(RAW); delete bad.mesos[0].log['0-0'].slots;
  const cases = [
    ['{"v":1,"mesos":[oops', 'invalid'],
    ['', 'invalid'],
    [null, 'invalid'],
    ['{}', 'invalid'],
    ['{"v":0,"exercises":[],"mesos":[]}', 'invalid'],
    [JSON.stringify(bad), 'invalid'],
    [JSON.stringify({ ...JSON.parse(RAW), v: 2 }), 'newer'],
  ];
  for (const [text, reason] of cases) {
    const st = fakeStorage({ [KEY]: CURRENT });
    let asked = false;
    const r = importInto(st, text, () => { asked = true; return true; });
    assert.deepEqual([r.ok, r.reason], [false, reason], String(text).slice(0, 40));
    assert.equal(asked, false);
    assert.deepEqual(st.writes, []);
  }
});

test('importInto: cancelled confirm writes nothing', () => {
  const st = fakeStorage({ [KEY]: CURRENT });
  const r = importInto(st, RAW, () => false);
  assert.deepEqual([r.ok, r.reason], [false, 'cancelled']);
  assert.deepEqual(st.writes, []);
});

test('importInto: if the before-import copy fails, KEY is not written', () => {
  const st = fakeStorage({ [KEY]: CURRENT });
  const set = st.setItem;
  st.setItem = (k, v) => { if (k === BEFORE_IMPORT_KEY) { st.writes.push(k); throw new Error('QuotaExceededError'); } set(k, v); };
  const r = importInto(st, RAW, yes);
  assert.deepEqual([r.ok, r.reason], [false, 'backup']);
  assert.ok(!st.writes.includes(KEY));
  assert.equal(st.dump()[KEY], CURRENT);
});

test('importInto on a phone with nothing stored yet: no backup needed, KEY written', () => {
  const st = fakeStorage();
  const r = importInto(st, RAW, yes);
  assert.equal(r.ok, true);
  assert.deepEqual(st.writes, [KEY]);
});

test('importInto: unreadable storage → nothing written', () => {
  const st = fakeStorage({ [KEY]: CURRENT }, { throwOnGet: true });
  const r = importInto(st, RAW, yes);
  assert.deepEqual([r.ok, r.reason], [false, 'storage']);
  assert.deepEqual(st.writes, []);
});
