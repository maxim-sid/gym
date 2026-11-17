'use strict';
// 3.3: warm-up sets (x.wu) are logged but never count as working sets.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (w, r, done = true, t) => ({ w: String(w), r: String(r), done, ...(t ? { t } : {}) });
const wu = (w, r, done = true, t) => ({ ...set(w, r, done, t), wu: true });
const blank = () => ({ w: '', r: '', done: false });
const lift = { id: 'a', bw: false };

function meso() {
  return {
    id: 'm', weeks: 3, deload: false, style: 'rp', pos: { w: 0, d: 0 }, complete: false, log: {},
    days: [{ name: 'A', weekday: null, exercises: [{ exId: 'a', plan: [2], reps: [8, 10], type: 'main' }] }],
  };
}

test('addWarmup: after existing warm-ups, at the top; +step chip / skipMarked indexes follow; Undo', () => {
  const sl = { sets: [wu(20, 10, false), blank(), blank()], bump: [1, 2], skipMarked: [2] };
  assert.equal(C.addWarmup(sl), 1);
  assert.deepEqual(sl.sets.map(x => !!x.wu), [true, true, false, false]);
  assert.deepEqual([sl.bump, sl.skipMarked], [[2, 3], [3]]);
  assert.deepEqual([0, 1, 2, 3].map(j => C.setLabel(sl, j)), ['W', 'W', '1', '2']);
  assert.equal(C.removeWarmup(sl, 1), true);
  assert.deepEqual([sl.sets.length, sl.bump, sl.skipMarked], [3, [1, 2], [2]]);
  sl.sets[0].w = '20';
  assert.equal(C.removeWarmup(sl, 0), false);                      // typed: Undo refused
});

test('warm-ups are not working sets: counts, history, stats, current card, all-logged', () => {
  const sl = { exId: 'a', sets: [wu(40, 8, true, 1), set(100, 8, true, 2), blank()], fb: {} };
  assert.deepEqual(C.doneSets(sl).map(x => x.w), ['100']);
  assert.deepEqual(C.countedSets(sl).map(x => x.w), ['100']);
  assert.equal(C.workSets(sl).length, 2);
  const s = { slots: [sl] };
  assert.deepEqual(C.nextSet(s), { i: 0, j: 2 });
  sl.sets[2] = set(100, 8, true, 3);
  sl.sets.unshift(wu('', '', false));                              // a blank warm-up never blocks "all logged"
  assert.equal(C.allLogged(s), true);
  assert.equal(C.currentSlot(s), -1);
  assert.equal(C.allLogged({ slots: [{ sets: [wu(40, 8)] }] }), false); // warm-ups alone aren't a workout
});

test('finish: base count and the review ignore warm-ups; an empty warm-up is dropped, a done one kept', () => {
  const m = meso();
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets = [wu(40, 8, true, 1), wu('', '', false), set(100, 8, true, 2), set(100, 8, true, 3)];
  s.slots[0].fb = { sore: 0, pump: 0, work: 0, joint: 0 };          // +2 sets
  const rv = C.finishReview(s);
  assert.deepEqual([rv.sets, rv.exercises, rv.empty], [2, 1, 1]);
  const { changes } = C.finishSession(m, 0, 0, s, 9);
  assert.deepEqual(changes, [{ exId: 'a', from: 2, to: 4 }]);       // base 2, not 4
  assert.deepEqual(s.slots[0].sets.map(x => !!x.wu), [true, false, false]);
  assert.equal(s.date, 1);                                           // the first tick may be a warm-up
});

test('a typed warm-up is in the Finish "typed" list; skipping the exercise leaves warm-ups alone', () => {
  const s = { slots: [{ exId: 'a', sets: [wu(40, '', false), set(100, 8, true, 2), blank()], fb: {} }] };
  assert.deepEqual(C.finishReview(s).typed, [{ i: 0, j: 0 }]);
  C.skipSlot(s.slots[0]);
  assert.deepEqual(s.slots[0].sets.map(x => !!x.skip), [false, false, true]);
});

test('prefill: working sets line up with last time’s working sets; warm-ups from last time’s warm-ups only', () => {
  const m = meso();
  m.log['0-0'] = { date: 5, done: true, slots: [{ exId: 'a', sets: [wu(40, 10), wu(60, 5), set(100, 8), set(105, 6)], fb: {} }] };
  const S = { exercises: [lift], mesos: [m] };
  const last = C.lastPerf(S, 'a');
  assert.deepEqual(last.sets.map(x => x.w), ['100', '105']);
  assert.deepEqual(last.wu.map(x => x.w), ['40', '60']);
  const sl = { exId: 'a', sets: [wu('', '', false), blank(), blank()] };
  assert.deepEqual(C.prefill(sl, 0, last, lift, {}), { w: '40', r: '10' });
  assert.deepEqual(C.prefill(sl, 1, last, lift, {}), { w: '100', r: '8' });  // working set 1 ↔ last time's set 1
  assert.deepEqual(C.prefill(sl, 2, last, lift, {}), { w: '105', r: '6' });
  const sl2 = { exId: 'a', sets: [wu('', '', false), wu('', '', false), wu('', '', false), blank()] };
  assert.deepEqual(C.prefill(sl2, 2, last, lift, {}), { w: '', r: '' }); // no third warm-up last time
  assert.deepEqual(C.prefill(sl2, 0, null, lift, {}), { w: '', r: '' });
  // A done warm-up is never "today's previous set" for a working set.
  const sl3 = { exId: 'a', sets: [wu(40, 12, true), blank()] };
  assert.deepEqual(C.prefill(sl3, 1, null, lift, {}), { w: '', r: '' });
});

test('acceptSet: a warm-up may have a blank weight; reps are still required', () => {
  assert.deepEqual(C.acceptSet(wu('', '10', false), { w: '', r: '' }, lift), { ok: true, w: '', r: '10' });
  assert.deepEqual(C.acceptSet(wu('', '', false), { w: '', r: '' }, lift), { error: 'reps' });
  assert.deepEqual(C.acceptSet(blank(), { w: '', r: '8' }, lift), { error: 'weight' });
});

test('−Set, deleteSet, tidySlots, +step chip and swaps leave warm-ups in place', () => {
  assert.equal(C.canRemoveLastSet({ sets: [set(1, 1), wu('', '', false)] }), false);
  assert.ok(C.deleteSet({ sets: [wu('', '', false), set(1, 1)] }, 0).set);   // a warm-up can always go
  assert.deepEqual(C.deleteSet({ sets: [wu('', '', false), blank()] }, 1), { error: 'last' });
  const s = { slots: [{ sets: [blank(), wu('', '', false)] }] };
  assert.equal(C.tidySlots(s), 0);
  const sl = { sets: [wu('', '', false), blank(), blank()] };
  C.toggleBump(sl, { sets: [set(100, 10), set(90, 10)] }, 2.5, [8, 10]);
  assert.deepEqual(sl.sets.map(x => x.w), ['', '102.5', '92.5']);
  assert.deepEqual(sl.bump, [1, 2]);
  const ss = { slots: [{ exId: 'a', sets: [wu('40', '', false), blank()], fb: {} }] };
  C.swapToday(ss, 0, 'b');
  assert.deepEqual(ss.slots[0].sets, [{ w: '', r: '', done: false, wu: true }, blank()]);
  // A warm-up row the user added is content: a plan change doesn't rebuild that slot.
  const m = meso();
  m.log['1-0'] = { done: false, slots: [{ exId: 'a', sets: [wu('', '', false), blank(), blank()], fb: {} }] };
  C.setPlanSets(m, 0, 0, 1, 4);
  assert.deepEqual(C.rebuildOpen(m), []);
  assert.equal(m.log['1-0'].slots[0].sets.length, 3);
});

test('shiftIdx: deleting a warm-up (or any set) keeps the +step chip pointing at the right sets', () => {
  const last = { sets: [set(100, 10), set(90, 10)] };
  const sl = { sets: [wu('', '', false), blank(), blank()] };
  C.toggleBump(sl, last, 2.5, [8, 10]);                       // fills working sets 1 and 2 (j 1, 2)
  assert.deepEqual(sl.bump, [1, 2]);
  const r = C.deleteSet(sl, 0);                               // delete the warm-up
  assert.deepEqual(sl.bump, [0, 1]);
  sl.sets[1].w = '95';                                        // user edits the second one
  C.toggleBump(sl, last, 2.5, [8, 10]);                       // chip off: clears only its unchanged set
  assert.deepEqual(sl.sets.map(x => x.w), ['', '95']);
  // Undo of a delete puts the set and its chip index back.
  const sl2 = { sets: [blank(), blank(), blank()] };
  C.toggleBump(sl2, last, 2.5, [8, 10]);
  const d = C.deleteSet(sl2, 1);
  assert.deepEqual(sl2.bump, [0, 1]);
  C.undeleteSet(sl2, 1, d);
  assert.deepEqual(sl2.bump, [0, 1, 2]);
  assert.equal(sl2.sets[1].w, '92.5');
  // Warm-up Undo, and skip-exercise marks.
  const sl3 = { sets: [blank(), blank()], skipMarked: [0, 1] };
  const j = C.addWarmup(sl3);
  assert.deepEqual(sl3.skipMarked, [1, 2]);
  C.removeWarmup(sl3, j);
  assert.deepEqual(sl3.skipMarked, [0, 1]);
  assert.ok(r.set.wu);
});
