'use strict';
// 1.4b: weight steps per exercise and the explicit ↑ +step chip.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (w, r, done = true) => ({ w: String(w), r: String(r), done });
const blank = () => ({ w: '', r: '', done: false });
const last = sets => ({ date: 1, sets });

test('roundTo: nearest multiple of the step, no float noise', () => {
  assert.equal(C.roundTo(7, 2), 8);        // 14 kg DB deload with step 2
  assert.equal(C.roundTo(7, 2.5), 7.5);
  assert.equal(C.roundTo(6.9, 1), 7);
  assert.equal(C.roundTo(3.7, 1.25), 3.75);
  assert.equal(C.roundTo(11.3, 1.25), 11.25);
  assert.equal(C.roundTo(22.5, 5), 25);     // lb plates
  assert.equal(C.roundTo(47, 5), 45);
  assert.equal(C.roundTo(0, 2), 0);
});

test('stepOf: the exercise\'s own step, else 2.5 kg / 5 lb', () => {
  assert.equal(C.stepOf({ step: 2 }, 'kg'), 2);
  assert.equal(C.stepOf({ step: 1.25 }, 'lb'), 1.25);
  assert.equal(C.stepOf({}, 'kg'), 2.5);
  assert.equal(C.stepOf(undefined, 'lb'), 5);
  assert.equal(C.stepOf({ step: 0 }, 'kg'), 2.5);
});

test('toggleBump: step 2 turns 14 into 16 with reps at the bottom of the range, only in untouched sets', () => {
  const L = last([set(14, 10), set(14, 10), set(14, 10), set(14, 10)]);
  const sl = { sets: [set(14, 10), { w: '15', r: '', done: false }, blank(), blank()] };
  assert.equal(C.toggleBump(sl, L, 2, [8, 10]), 2);
  assert.deepEqual(sl.sets, [set(14, 10), { w: '15', r: '', done: false }, { w: '16', r: '8', done: false }, { w: '16', r: '8', done: false }]);
  assert.equal(C.bumpOn(sl), true);
  assert.deepEqual(sl.bump, [2, 3]);
});

// Changed deliberately (review of 1.4b): the chip state is the sl.bump flag, never inferred from values.
test('toggleBump again: off, clearing only chip values that are still unticked and unchanged', () => {
  const L = last([set(14, 10), set(14, 10), set(14, 10)]);
  const sl = { sets: [blank(), blank(), blank()] };
  C.toggleBump(sl, L, 2, [8, 10]);
  sl.sets[1].r = '9';                    // user changed one
  sl.sets[0].done = true;                // and ticked one between the taps
  assert.equal(C.toggleBump(sl, L, 2, [8, 10]), 1);
  assert.deepEqual(sl.sets, [{ w: '16', r: '8', done: true }, { w: '16', r: '9', done: false }, blank()]);
  assert.equal(C.bumpOn(sl), false);
  assert.equal('bump' in sl, false);
});

test('hand-typed values equal to the bump do not switch the chip on and are never cleared (review repro)', () => {
  const L = last([set(60, 10), set(60, 10), set(60, 10)]);
  const sl = { sets: [blank(), { w: '62.5', r: '8', done: false }, blank()] };
  assert.equal(C.bumpOn(sl), false);                       // was "on" with value matching
  assert.equal(C.toggleBump(sl, L, 2.5, [8, 10]), 2);      // tap 1 fills sets 1 and 3
  assert.deepEqual(sl.bump, [0, 2]);
  assert.equal(C.toggleBump(sl, L, 2.5, [8, 10]), 2);      // tap 2 clears only those
  assert.deepEqual(sl.sets, [blank(), { w: '62.5', r: '8', done: false }, blank()]);
});

test('toggleBump undo survives −Set removing a filled set', () => {
  const L = last([set(60, 10), set(60, 10)]);
  const sl = { sets: [blank(), blank()] };
  C.toggleBump(sl, L, 2.5, [8, 10]);
  sl.sets.pop();
  assert.equal(C.toggleBump(sl, L, 2.5, [8, 10]), 1);
  assert.deepEqual(sl.sets, [blank()]);
});

test('toggleBump uses each set\'s own last weight (lb, step 5)', () => {
  const L = last([set(135, 10), set(125, 10)]);
  const sl = { sets: [blank(), blank(), blank()] };
  C.toggleBump(sl, L, 5, [6, 10]);
  assert.deepEqual(sl.sets.map(x => x.w), ['140', '130', '130']);
});

test('after the chip, the reps rule does not flip reps back, and ✓ logs the bumped values', () => {
  const L = last([set(14, 10), set(14, 10)]);
  const sl = { sets: [blank(), blank()] };
  C.toggleBump(sl, L, 2, [8, 10]);
  assert.deepEqual(C.prefill(sl, 1, L, { bw: false }, { step: 2 }), { w: '14', r: '10' }); // the suggestion only…
  assert.deepEqual(C.acceptSet(sl.sets[1], C.prefill(sl, 1, L, { bw: false }, { step: 2 }), { bw: false }),
    { ok: true, w: '16', r: '8' });                                                       // …typed values win
  C.tickSet(sl.sets[0], C.acceptSet(sl.sets[0], {}, { bw: false }), 1);
  assert.deepEqual(C.acceptSet(sl.sets[1], C.prefill(sl, 1, L, { bw: false }, { step: 2 }), { bw: false }),
    { ok: true, w: '16', r: '8' });
});

/* ---------- 1.8: Undo helpers ---------- */

test('snapSet/restoreSet: Undo of an untick brings back done and t exactly', () => {
  const st = { w: '60', r: '8', done: true, t: 123 };
  const snap = C.snapSet(st);
  C.untickSet(st);
  assert.deepEqual(st, { w: '60', r: '8', done: false });
  C.restoreSet(st, snap);
  assert.deepEqual(st, { w: '60', r: '8', done: true, t: 123 });
  const st2 = { w: '', r: '', done: false };
  const snap2 = C.snapSet(st2);
  C.tickSet(st2, { w: '50', r: '5' }, 9);
  C.restoreSet(st2, snap2);
  assert.deepEqual(st2, { w: '', r: '', done: false }); // fields added since (t) are removed
});

test('chip Undo = a second toggle: clears exactly what the first one filled', () => {
  const L = last([set(60, 10), set(60, 10)]);
  const sl = { sets: [blank(), { w: '61', r: '', done: false }] };
  const before = JSON.parse(JSON.stringify(sl));
  C.toggleBump(sl, L, 2.5, [8, 10]);
  C.toggleBump(sl, L, 2.5, [8, 10]);
  assert.deepEqual(sl, before);
});

test('setStep: offered steps are stored, anything else clears to the unit default', () => {
  const { setStep, STEPS, stepOf } = require('../core.js');
  assert.deepEqual(STEPS, [1, 1.25, 2, 2.5, 5]);
  const ex = {};
  assert.equal(setStep(ex, '2').step, 2);
  assert.equal(stepOf(ex, 'kg'), 2);
  setStep(ex, 1.25); assert.equal(ex.step, 1.25);
  setStep(ex, ''); assert.equal('step' in ex, false);
  assert.equal(stepOf(ex, 'kg'), 2.5);
  setStep(ex, 3); assert.equal('step' in ex, false);
  setStep(ex, -1); assert.equal('step' in ex, false);
});
