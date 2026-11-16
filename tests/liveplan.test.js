'use strict';
// 2.9a: editing a live block's plan from the workout screen; +1 week.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (w, r, done = true) => ({ w: String(w), r: String(r), done });
const blank = () => ({ w: '', r: '', done: false });

function meso(deload = false) {
  return {
    id: 'm', weeks: 4, deload, style: 'rp', pos: { w: 1, d: 0 }, complete: false, log: {},
    days: [{ name: 'A', weekday: null, exercises: [
      { exId: 'a', plan: [3, 3], reps: [8, 10], type: 'main', notes: 'n' },
      { exId: 'b', plan: [2], reps: [10, 12], type: 'accessory' },
    ] }],
  };
}

test('planFromWeek: the shown week, or the next once it is finished', () => {
  const m = meso();
  assert.equal(C.planFromWeek(m, 1, 0), 1);
  m.log['1-0'] = { done: true, slots: [] };
  assert.equal(C.planFromWeek(m, 1, 0), 2);
});

test('setPlanSets: from that week on (later entries dropped), earlier weeks unchanged, 1–12', () => {
  const m = meso();
  m.days[0].exercises[0].plan = [3, 3, 4, 5];
  C.setPlanSets(m, 0, 0, 1, 6);
  assert.deepEqual(m.days[0].exercises[0].plan, [3, 6]);
  assert.deepEqual([0, 1, 2, 3].map(w => C.plannedSets(m, 0, 0, w)), [3, 6, 6, 6]);
  C.setPlanSets(m, 0, 1, 3, 0);
  assert.deepEqual(m.days[0].exercises[1].plan, [2, null, null, 1]);
  assert.deepEqual([0, 2, 3].map(w => C.plannedSets(m, 0, 1, w)), [2, 2, 1]);
  C.setPlanSets(m, 0, 1, 0, 99);
  assert.deepEqual(m.days[0].exercises[1].plan, [12]);
});

test('parseRange: both, one, reversed, empty', () => {
  assert.deepEqual(C.parseRange('6', '8'), [6, 8]);
  assert.deepEqual(C.parseRange('10', '8'), [8, 10]);
  assert.deepEqual(C.parseRange('12', ''), [12, 12]);
  assert.deepEqual(C.parseRange('', ' 5 '), [5, 5]);
  assert.equal(C.parseRange('', ''), null);
  assert.equal(C.parseRange('0', 'x'), null);
  assert.deepEqual(C.parseRange('300', '2'), [2, 100]);
});

test('rebuildOpen: empty slots of open sessions follow the plan; content, done and skipped untouched; Undo', () => {
  const m = meso();
  m.log['0-0'] = { done: true, slots: [{ exId: 'a', sets: [set(60, 8)], fb: {} }, { exId: 'b', sets: [set(20, 10)], fb: {} }] };
  m.log['1-0'] = { done: false, slots: [{ exId: 'a', sets: [blank(), blank(), blank()], fb: {} }, { exId: 'b', sets: [{ w: '20', r: '', done: false }, blank()], fb: {} }] };
  m.log['2-0'] = { done: false, skipped: true, slots: [{ exId: 'a', sets: [blank()], fb: {} }, { exId: 'b', sets: [blank()], fb: {} }] };
  m.log['3-0'] = { done: false, slots: [{ exId: 'a', sets: [blank(), blank(), blank()], fb: {} }, { exId: 'b', sets: [blank(), blank()], fb: {} }] };
  const before = JSON.parse(JSON.stringify(m.log));
  C.setPlanSets(m, 0, 0, 1, 5);
  m.days[0].exercises[1].exId = 'c';
  const rb = C.rebuildOpen(m);
  assert.deepEqual(m.log['0-0'], before['0-0']);                   // done
  assert.deepEqual(m.log['2-0'], before['2-0']);                   // skipped
  assert.equal(m.log['1-0'].slots[0].sets.length, 5);
  assert.deepEqual(m.log['1-0'].slots[1], before['1-0'].slots[1]); // typed: kept as is
  assert.equal(m.log['3-0'].slots[0].sets.length, 5);
  assert.equal(m.log['3-0'].slots[1].exId, 'c');
  assert.deepEqual(rb.map(x => `${x.k}/${x.i}`).sort(), ['1-0/0', '3-0/0', '3-0/1']);
  C.restoreRebuilt(m, rb);
  assert.deepEqual(m.log, before);
  assert.deepEqual(C.rebuildOpen(meso()), []);                     // nothing stored, nothing to do
});

test('canAddWeek / addWeek: deload moves to the new last week; refused once the deload week has a session', () => {
  const m = meso(true);
  m.complete = true; m.pos = { w: 4, d: 0 };
  assert.equal(C.canAddWeek(m), true);
  const r = C.addWeek(m);
  assert.equal(m.weeks, 5);
  assert.equal(C.isDeload(m, 5), true);
  assert.equal(C.isDeload(m, 4), false);
  assert.equal(m.complete, false);
  assert.equal(C.plannedSets(m, 0, 0, 4), 3);                     // repeats the last entry
  C.restoreWeek(m, r.snap);
  assert.deepEqual([m.weeks, m.complete, m.pos], [4, true, { w: 4, d: 0 }]);
  m.log['4-0'] = { done: false, slots: [] };                      // the deload week has a session
  assert.equal(C.canAddWeek(m), false);
  assert.deepEqual(C.addWeek(m), { error: 'deload' });
  const n = meso(false);
  n.log['4-0'] = { done: true, slots: [] };
  assert.equal(C.canAddWeek(n), true);                            // no deload: always
});
