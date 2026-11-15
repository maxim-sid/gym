'use strict';
// 1.4: "Last time" follows the exercise (lastPerf), suggestions follow today's sets (prefill).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../core.js');

const set = (w, r, done = true) => ({ w: String(w), r: String(r), done });
const blank = () => ({ w: '', r: '', done: false });

// Two blocks of one day each; block 2 is the new one (no history of its own).
function twoBlocks() {
  const day = exIds => ({ name: 'D', weekday: null, exercises: exIds.map(exId => ({ exId, plan: [2], reps: [6, 8], type: 'main' })) });
  const b1 = { id: 'b1', weeks: 2, deload: true, style: 'fixed', days: [day(['sq', 'dip'])], pos: { w: 0, d: 0 }, log: {} };
  const b2 = { id: 'b2', weeks: 2, deload: false, style: 'fixed', days: [day(['sq', 'dip'])], pos: { w: 0, d: 0 }, log: {} };
  b1.log['0-0'] = { date: 100, done: true, slots: [{ exId: 'sq', sets: [set(100, 8), set(100, 7)] }, { exId: 'dip', sets: [set(20, 8)] }] };
  b1.log['1-0'] = { date: 200, done: true, slots: [{ exId: 'sq', sets: [set(105, 6), set(105, 6)] }, { exId: 'dip', sets: [set(22.5, 6)] }] };
  b1.log['2-0'] = { date: 300, done: true, slots: [{ exId: 'sq', sets: [set(50, 8)] }, { exId: 'dip', sets: [set('', 8)] }] }; // deload
  return { exercises: [], mesos: [b1, b2] };
}

/* ---------- lastPerf ---------- */

test('lastPerf crosses blocks and skips deload weeks', () => {
  const S = twoBlocks();
  const r = C.lastPerf(S, 'sq');
  assert.equal(r.date, 200);           // not the deload session at 300
  assert.equal(r.m.id, 'b1');
  assert.deepEqual(r.sets, [set(105, 6), set(105, 6)]);
  assert.equal(r.note, '');
});

test('lastPerf skips unfinished sessions and sets with 0 reps or not done', () => {
  const S = twoBlocks();
  S.mesos[1].log['0-0'] = { date: null, done: false, slots: [{ exId: 'sq', sets: [set(110, 5)] }] };
  S.mesos[0].log['1-0'].slots[0].sets = [set(105, 0), set(105, 6, false)]; // nothing counted at 200
  const r = C.lastPerf(S, 'sq');
  assert.equal(r.date, 100);
  assert.equal(C.lastPerf(S, 'nope'), null);
});

test('lastPerf follows the exercise, not the slot: a swapped slot does not feed the original', () => {
  const S = twoBlocks();
  S.mesos[0].log['1-0'].slots[0].exId = 'goblet'; // slot 0 held another exercise that day
  assert.equal(C.lastPerf(S, 'sq').date, 100);
  assert.equal(C.lastPerf(S, 'goblet').date, 200);
});

test('lastPerf occurrence: the k-th slot of the exercise, else the last one', () => {
  const S = twoBlocks();
  S.mesos[0].log['1-0'].slots.push({ exId: 'sq', sets: [set(60, 12)] });
  assert.deepEqual(C.lastPerf(S, 'sq').sets.map(x => x.w), ['105', '105']);
  assert.deepEqual(C.lastPerf(S, 'sq', { occurrence: 1 }).sets.map(x => x.w), ['60']);
  assert.deepEqual(C.lastPerf(S, 'sq', { occurrence: 5 }).sets.map(x => x.w), ['60']);
});

test('lastPerf exclude/before: viewing an old workout shows the one before it', () => {
  const S = twoBlocks();
  const s200 = S.mesos[0].log['1-0'];
  assert.equal(C.lastPerf(S, 'sq', { exclude: s200 }).date, 100);
  assert.equal(C.lastPerf(S, 'sq', { before: 200 }).date, 100);
  assert.equal(C.lastPerf(S, 'sq', { before: 100 }), null);
});

/* ---------- prefill ---------- */

const lift = { bw: false }, bwEx = { bw: true };
const last = sets => ({ date: 1, sets });

test('prefill order: today\'s previous set → last[j] → last\'s final set → blank', () => {
  const L = last([set(100, 8), set(100, 7)]);
  const sl = { sets: [blank(), blank(), blank()] };
  assert.deepEqual(C.prefill(sl, 0, L, lift), { w: '100', r: '8' });
  assert.deepEqual(C.prefill(sl, 1, L, lift), { w: '100', r: '7' });
  assert.deepEqual(C.prefill(sl, 2, L, lift), { w: '100', r: '7' });   // beyond last time: final set
  sl.sets[0] = set(102.5, 8);
  assert.deepEqual(C.prefill(sl, 1, L, lift), { w: '102.5', r: '8' }); // weight changed → today's reps
  sl.sets[0] = set(100, 8);
  assert.deepEqual(C.prefill(sl, 1, L, lift), { w: '100', r: '7' });   // same weight → last time's target
  assert.deepEqual(C.prefill({ sets: [blank()] }, 0, null, lift), { w: '', r: '' });
  assert.deepEqual(C.prefill({ sets: [set(60, 10), blank()] }, 1, null, lift), { w: '60', r: '10' });
});

test('prefill: today\'s nearest EARLIER counted set (not later ones, not unticked/0-rep ones)', () => {
  const sl = { sets: [set(80, 8), set(90, 0), { w: '95', r: '5', done: false }, blank(), set(200, 1)] };
  assert.deepEqual(C.prefill(sl, 3, null, lift), { w: '80', r: '8' });
});

test('prefill reps: a weight typed for this set that differs from last time uses today\'s reps', () => {
  const L = last([set(100, 8), set(100, 8)]);
  const sl = { sets: [set(100, 6), { w: '110', r: '', done: false }] };
  assert.deepEqual(C.prefill(sl, 1, L, lift), { w: '100', r: '6' }); // shown weight 100 is not used (typed 110 wins)
  sl.sets[1].w = '100';
  assert.deepEqual(C.prefill(sl, 1, L, lift), { w: '100', r: '8' });
});

test('prefill: a 0/blank weight is no suggestion for a weighted lift; bodyweight stays BW', () => {
  const L0 = last([set(0, 10)]);
  assert.deepEqual(C.prefill({ sets: [blank()] }, 0, L0, lift), { w: '', r: '10' });
  const sl = { sets: [set(0, 9), blank()] };
  assert.deepEqual(C.prefill(sl, 1, last([set(60, 8)]), lift), { w: '60', r: '8' }); // today's 0 ignored → last time's 60 and its reps
  const b = { sets: [set('', 8), blank()] };
  assert.deepEqual(C.prefill(b, 1, last([set(20, 8), set(20, 8)]), bwEx), { w: '', r: '8' }); // BW today stays BW
});

// Changed deliberately in 1.4b: the ↑ bump is no longer baked into the suggestion (it was 14 → 17.5, F15),
// and the deload halving rounds to the exercise's step instead of the unit's 2.5/5.
test('prefill shows last time\'s real weight; deload halves it to the exercise\'s step', () => {
  const L = last([set(14, 10), set(14, 10)]);
  assert.deepEqual(C.prefill({ sets: [blank(), blank()] }, 0, L, lift, { step: 2 }), { w: '14', r: '10' });
  assert.deepEqual(C.prefill({ sets: [blank()] }, 0, L, lift, { deload: true, step: 2 }), { w: '8', r: '10' });
  assert.deepEqual(C.prefill({ sets: [blank()] }, 0, L, lift, { deload: true, step: 2.5 }), { w: '7.5', r: '10' });
  assert.deepEqual(C.prefill({ sets: [blank()] }, 0, last([set(45, 8)]), lift, { deload: true, step: 5 }), { w: '25', r: '8' });
});

test('slotHints: ↑ compares against the CURRENT slot\'s rep range', () => {
  const L = last([set(60, 10), set(60, 12)]);
  assert.deepEqual(C.slotHints(L, [8, 10], false), { hitTop: true, weighted: true });
  assert.deepEqual(C.slotHints(L, [10, 12], false), { hitTop: false, weighted: true });
  assert.deepEqual(C.slotHints(L, [8, 10], true), { hitTop: false, weighted: true });
  assert.deepEqual(C.slotHints(null, [8, 10], false), { hitTop: false, weighted: false });
});

/* ---------- ✓ uses the pure path ---------- */

test('✓ = acceptSet(set, prefill(...)) on the data; app.js no longer reads input placeholders', () => {
  const sl = { sets: [set(100, 8), blank()] };
  const sug = C.prefill(sl, 1, last([set(100, 8), set(100, 7)]), lift);
  assert.deepEqual(C.acceptSet(sl.sets[1], sug, lift), { ok: true, w: '100', r: '7' });
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.equal(/\.placeholder\b/.test(app), false);
  assert.equal(/\bprevSlot\b/.test(app), false);
});
