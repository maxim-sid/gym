'use strict';
// 2.4: skip a set or an exercise. Skipped sets keep their numbers but never count; the plan holds.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (w, r, done = true) => ({ w: String(w), r: String(r), done });
const blank = () => ({ w: '', r: '', done: false });
const sk = (w, r) => ({ w: String(w), r: String(r), done: false, skip: true });

function meso(style = 'rp') {
  return {
    id: 'm', weeks: 3, deload: false, style, pos: { w: 0, d: 0 }, complete: false, log: {},
    days: [{ name: 'A', weekday: null, exercises: [
      { exId: 'a', plan: [3], reps: [8, 10], type: 'main' },
      { exId: 'b', plan: [2], reps: [10, 12], type: 'accessory' },
    ] }],
  };
}

test('skipSet / unskipSet: values kept, done sets refused', () => {
  const st = { w: '60', r: '8', done: false };
  assert.equal(C.skipSet(st), true);
  assert.deepEqual(st, sk(60, 8));
  C.unskipSet(st);
  assert.deepEqual(st, { w: '60', r: '8', done: false });
  const d = set(60, 8);
  assert.equal(C.skipSet(d), false);
  assert.equal('skip' in d, false);
});

test('skipSlot / unskipSlot: done sets stay, individually skipped sets stay skipped', () => {
  const sl = { exId: 'a', sets: [set(60, 8), sk(60, 7), blank(), { w: '60', r: '', done: false }], fb: {} };
  const before = JSON.parse(JSON.stringify(sl));
  assert.equal(C.skipSlot(sl), true);
  assert.equal(sl.skip, true);
  assert.deepEqual(sl.sets.map(x => [x.done, !!x.skip]), [[true, false], [false, true], [false, true], [false, true]]);
  assert.equal(sl.sets[3].w, '60');                       // typed numbers kept
  assert.equal(C.skipSlot(sl), false);                     // already skipped
  assert.equal(C.unskipSlot(sl), true);
  assert.deepEqual(sl, before);                            // set 2 was skipped on its own: still is
  assert.equal(C.unskipSlot(sl), false);
});

test('deleteSet: not a done set, not the only set; splice puts it back', () => {
  const sl = { sets: [set(60, 8), { w: '60', r: '', done: false }, blank()] };
  assert.deepEqual(C.deleteSet(sl, 0), { error: 'done' });
  const r = C.deleteSet(sl, 1);
  assert.deepEqual(r.set, { w: '60', r: '', done: false });
  assert.equal(sl.sets.length, 2);
  sl.sets.splice(1, 0, r.set);
  assert.equal(sl.sets[1].w, '60');
  assert.deepEqual(C.deleteSet({ sets: [blank()] }, 0), { error: 'last' });
  assert.deepEqual(C.deleteSet(sl, 9), { error: 'missing' });
});

test('skipped sets are excluded from lastPerf, perfFor and chartPoints', () => {
  const m = meso('fixed');
  m.log['0-0'] = { date: 100, done: true, slots: [{ exId: 'a', sets: [set(60, 8), sk(100, 10)], fb: {} }, { exId: 'b', sets: [sk(20, 12)], skip: true, fb: {} }] };
  const S = { exercises: [{ id: 'a', name: 'A', muscle: 'Chest' }, { id: 'b', name: 'B', muscle: 'Back' }], mesos: [m] };
  assert.deepEqual(C.lastPerf(S, 'a').sets, [set(60, 8)]);
  assert.equal(C.lastPerf(S, 'b'), null);                  // only skipped: no "last time"
  assert.deepEqual(C.perfFor(S, 'a').map(p => p.sets.length), [1]);
  assert.deepEqual(C.perfFor(S, 'b'), []);
  assert.deepEqual(C.chartPoints(S, S.exercises[0]).points.map(p => Math.round(p.y)), [Math.round(C.e1rm(60, 8))]);
  // prefill never takes a skipped earlier set as today's previous
  const today = { exId: 'a', sets: [sk(100, 3), blank()] };
  assert.equal(C.prefill(today, 1, C.lastPerf(S, 'a'), S.exercises[0], {}).w, '60');
});

test('finish: a skipped slot keeps the base count (never shrinks); its typed skipped sets are not counted', () => {
  const m = meso('rp');
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets = [set(60, 8), { w: '60', r: '8', done: false }, blank()]; // 1 done, 1 typed, 1 empty
  C.skipSlot(s.slots[0]);                                   // machine taken: skip the rest
  s.slots[0].fb = { sore: 3 };                              // would be −1
  s.slots[1].sets = [set(20, 12), set(20, 12)];
  s.slots[1].fb = { sore: 0, pump: 0, work: 0, joint: 0 };  // +2
  const rv = C.finishReview(s);
  assert.deepEqual([rv.skipped, rv.notStarted, rv.sets, rv.typed.length, rv.empty], [1, 0, 3, 0, 0]);
  const { changes } = C.finishSession(m, 0, 0, s, 1000);
  assert.equal(m.days[0].exercises[0].plan[1], 3);          // base 3, held
  assert.deepEqual(changes, [{ exId: 'b', from: 2, to: 4 }]);
  assert.equal(s.slots[0].skip, true);                      // a finished workout keeps its skips
  assert.equal(s.slots[0].sets.length, 3);                  // skipped sets are kept (with their numbers)
  assert.deepEqual(C.doneSets(s.slots[0]).length, 1);
  assert.deepEqual(C.countedSets(s.slots[0]).length, 1);
});

test('a skipped set inside an unskipped slot: counted in base (rp holds that set), not in stats', () => {
  const m = meso('fixed');
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets = [set(60, 8), set(60, 8), sk(60, 8)];
  C.finishSession(m, 0, 0, s, 1000);
  assert.equal(s.slots[0].sets.length, 3);
  assert.equal(C.countedSets(s.slots[0]).length, 2);
});

test('skips are content: hasContent, swapBlock leaves them, bump and −Set ignore them, tidySlots keeps them', () => {
  assert.equal(C.hasContent({ done: false, slots: [{ skip: true, sets: [] }] }), true);
  assert.equal(C.hasContent({ done: false, slots: [{ sets: [sk('', '')] }] }), true);
  assert.equal(C.canRemoveLastSet({ sets: [blank(), sk('', '')] }), false);
  const s = { slots: [{ sets: [blank(), sk('', '')] }] };
  assert.equal(C.tidySlots(s), 0);
  const sl = { sets: [blank(), sk('', '')] };
  C.toggleBump(sl, { sets: [set(60, 10), set(60, 10)] }, 2.5, [8, 10]);
  assert.deepEqual(sl.sets[1], sk('', ''));
});

test('swapToday on a skipped slot un-skips it (skipMarked goes too)', () => {
  const s = { slots: [{ exId: 'a', sets: [blank()], fb: {} }] };
  C.skipSlot(s.slots[0]);
  C.swapToday(s, 0, 'b');
  assert.deepEqual(s.slots[0], { exId: 'b', from: 'a', sets: [blank()], fb: {} });
});

test('finish rewrites next week’s stored slot only while it is untouched', () => {
  const m = meso('rp');
  const s = C.session(m, 0, 0, true);
  s.slots.forEach(sl => { sl.sets = sl.sets.map(() => set(60, 8)); sl.fb = { sore: 0, pump: 0, work: 0, joint: 0 }; }); // +2 each
  const next = C.session(m, 1, 0, true);
  next.slots[0].sets[0] = { w: '62', r: '', done: false };      // typed
  next.slots[1].sets[0].skip = true;                            // a skipped set
  const before = JSON.parse(JSON.stringify(next));
  C.finishSession(m, 0, 0, s, 1000);
  assert.deepEqual(next, before);
  // ...a skipped slot, a swapped slot: also left; an untouched one takes the new count.
  const m2 = meso('rp');
  const s2 = C.session(m2, 0, 0, true);
  s2.slots.forEach(sl => { sl.sets = sl.sets.map(() => set(60, 8)); sl.fb = { sore: 0, pump: 0, work: 0, joint: 0 }; });
  const n2 = C.session(m2, 1, 0, true);
  C.swapToday(n2, 0, 'zz');
  C.finishSession(m2, 0, 0, s2, 1000);
  assert.equal(n2.slots[0].sets.length, 3);
  assert.equal(n2.slots[1].sets.length, 4);
  const m3 = meso('rp');
  const s3 = C.session(m3, 0, 0, true);
  s3.slots.forEach(sl => { sl.sets = sl.sets.map(() => set(60, 8)); sl.fb = { sore: 0, pump: 0, work: 0, joint: 0 }; });
  const n3 = C.session(m3, 1, 0, true);
  C.skipSlot(n3.slots[1]);
  C.finishSession(m3, 0, 0, s3, 1000);
  assert.equal(n3.slots[1].sets.length, 2);
  assert.equal(n3.slots[0].sets.length, 5);
});
