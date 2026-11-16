'use strict';
// 2.9b: append an exercise to a live day; retire / reinstate one; readers tolerate sessions with fewer slots.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (w, r, done = true, t) => ({ w: String(w), r: String(r), done, ...(t ? { t } : {}) });
const blank = () => ({ w: '', r: '', done: false });

function meso() {
  const m = {
    id: 'm', name: 'B', weeks: 4, deload: false, style: 'rp', pos: { w: 1, d: 0 }, complete: false, log: {},
    days: [{ name: 'A', weekday: null, exercises: [
      { exId: 'a', plan: [2], reps: [8, 10], type: 'main' },
      { exId: 'b', plan: [2], reps: [10, 12], type: 'accessory' },
    ] }, { name: 'B', weekday: null, exercises: [{ exId: 'c', plan: [2], reps: [8, 10], type: 'main' }] }],
  };
  m.log['0-0'] = { date: 10, done: true, slots: [{ exId: 'a', sets: [set(60, 8, true, 10)], fb: {} }, { exId: 'b', sets: [set(20, 10, true, 11)], fb: {} }] };
  m.log['1-0'] = { date: null, done: false, slots: [{ exId: 'a', sets: [blank(), blank()], fb: {} }, { exId: 'b', sets: [blank(), blank()], fb: {} }] };
  m.log['2-0'] = { date: null, done: false, skipped: true, skippedAt: 5, slots: [{ exId: 'a', sets: [blank(), blank()], fb: {} }, { exId: 'b', sets: [blank(), blank()], fb: {} }] };
  m.log['1-1'] = { date: null, done: false, slots: [{ exId: 'c', sets: [blank(), blank()], fb: {} }] };
  return m;
}

test('appendSlot: plan slot with builder defaults; open and skipped sessions of that day get a slot; done ones don’t', () => {
  const m = meso();
  const r = C.appendSlot(m, 0, 'z');
  assert.equal(r.i, 2);
  assert.deepEqual(m.days[0].exercises[2], { exId: 'z', plan: [2], reps: null, type: 'accessory', notes: '', timed: false });
  assert.deepEqual(m.log['1-0'].slots[2], { exId: 'z', sets: [blank(), blank()], fb: {} });
  assert.deepEqual(m.log['2-0'].slots[2], { exId: 'z', sets: [], fb: {} });       // skipped: empty
  assert.equal(m.log['0-0'].slots.length, 2);                                     // done: unchanged
  assert.equal(m.log['1-1'].slots.length, 1);                                     // other day: unchanged
  assert.deepEqual(r.keys.sort(), ['1-0', '2-0']);
  assert.equal(C.blankSession(m, 3, 0).slots.length, 3);                          // new sessions have it
  assert.equal(C.removeAppended(m, 0, r), true);                                  // Undo
  assert.deepEqual(m, meso());
});

test('removeAppended refuses once something was logged in the new slot', () => {
  const m = meso();
  const r = C.appendSlot(m, 0, 'z');
  m.log['1-0'].slots[2].sets[0].w = '10';
  assert.equal(C.canRemoveAppended(m, 0, r), false);
  assert.equal(C.removeAppended(m, 0, r), false);
  assert.equal(m.days[0].exercises.length, 3);
});

test('retireSlot: plannedSets 0, open empty slots emptied, content kept, no progression; reinstate; Undo', () => {
  const m = meso();
  const before = JSON.parse(JSON.stringify(m));
  m.log['3-0'] = { date: null, done: false, slots: [{ exId: 'a', sets: [blank(), blank()], fb: {} }, { exId: 'b', sets: [{ w: '20', r: '', done: false }, blank()], fb: {} }] };
  const r = C.retireSlot(m, 0, 1);
  assert.equal(m.days[0].exercises[1].off, true);
  assert.equal(C.plannedSets(m, 0, 1, 1), 0);
  assert.deepEqual(m.log['1-0'].slots[1].sets, []);                               // empty → no sets
  assert.equal(m.log['3-0'].slots[1].sets.length, 2);                             // typed → kept
  assert.deepEqual(m.log['0-0'], before.log['0-0']);                              // history intact
  assert.deepEqual(m.log['2-0'], before.log['2-0']);                              // skipped untouched
  assert.deepEqual(C.blankSession(m, 3, 0).slots[1].sets, []);
  assert.deepEqual(C.retireSlot(m, 0, 1), { error: 'same' });
  // The open workout: the retired slot doesn't count anywhere.
  const s = m.log['1-0'];
  s.slots[0].sets = [set(60, 8, true, 20), set(60, 8, true, 21)];
  s.slots[0].fb = { sore: 0, pump: 0, work: 0, joint: 0 };
  assert.equal(C.currentSlot(s), -1);
  assert.equal(C.nextSet(s), null);
  assert.equal(C.allLogged(s), true);
  const rv = C.finishReview(s);
  assert.deepEqual([rv.of, rv.exercises, rv.notStarted], [1, 1, 0]);
  const { changes } = C.finishSession(m, 1, 0, s, 99);
  assert.deepEqual(changes.map(c => c.exId), ['a']);                               // retired: no progression
  assert.equal(m.days[0].exercises[1].plan[2], undefined);
  // Reinstate: open empty slots come back with their planned sets.
  const r2 = C.reinstateSlot(m, 0, 1);
  assert.equal(m.days[0].exercises[1].off, undefined);
  assert.equal(C.blankSession(m, 3, 0).slots[1].sets.length, 2);
  C.restorePlanSlot(m, 0, 1, r2.snap);                                             // Undo of reinstate
  assert.equal(m.days[0].exercises[1].off, true);
  C.restorePlanSlot(m, 0, 1, r.snap);                                              // Undo of retire
  assert.equal(m.days[0].exercises[1].off, undefined);
});

test('readers tolerate an old finished session with fewer slots than the plan', () => {
  const m = meso();
  C.appendSlot(m, 0, 'z');
  m.log['1-0'].slots[2].sets = [set(10, 12, true, 30)];
  const S = { exercises: ['a', 'b', 'z'].map(id => ({ id, name: id, muscle: 'Chest' })), mesos: [m], activeId: 'm' };
  const old = m.log['0-0'];                                                       // 2 slots, plan has 3
  assert.equal(old.slots.length, 2);
  assert.equal(C.lastPerf(S, 'a').date, 10);
  assert.equal(C.lastPerf(S, 'z'), null);
  assert.deepEqual(C.perfFor(S, 'b').length, 1);
  assert.equal(C.currentSlot(old), -1);
  assert.equal(C.nextSet(old), null);
  assert.equal(C.hasContent(old), true);
  assert.equal(C.swappedFrom(m, 0, old, 2), null);
  assert.equal(C.occurrenceOf(m, 0, old, 2), 0);
  assert.equal(C.finishReview(old).of, 2);
  assert.equal(typeof C.fmtSets(old.slots[0].sets, S.exercises[0], 'kg'), 'string');
  assert.deepEqual(C.rebuildOpen(m), []);                                          // skips the short done session
  assert.ok(C.swapBlock(m, 0, 2, 'a', '1-0').error);                              // today's slot 2 has a done set
  C.retireSlot(m, 0, 2);                                                           // and retire passes over it too
  assert.equal(m.log['0-0'].slots.length, 2);
  // Finishing the open one after the append: no crash on the shorter plan entries.
  const s = m.log['1-0'];
  assert.doesNotThrow(() => C.finishSession(m, 1, 0, s, 50));
});

test('append Undo with a shown-only next-up workout that gets stored afterwards', () => {
  // Appended while W2 Day A was only shown (not stored); then it gets stored.
  let m = meso();
  delete m.log['1-0'];
  let r = C.appendSlot(m, 0, 'z');
  assert.deepEqual(r.keys, ['2-0']);
  m.log['1-0'] = C.blankSession(m, 1, 0);                              // stored by the first write
  m.log['1-0'].slots[2].sets[0] = set(10, 12);                         // ...into the new slot
  assert.equal(C.canRemoveAppended(m, 0, r), false);
  assert.equal(C.removeAppended(m, 0, r), false);
  assert.equal(m.days[0].exercises.length, 3);
  // Stored but empty: Undo removes the slot everywhere (plan, stored, skipped).
  m = meso();
  delete m.log['1-0'];
  r = C.appendSlot(m, 0, 'z');
  m.log['1-0'] = C.blankSession(m, 1, 0);
  assert.equal(C.removeAppended(m, 0, r), true);
  assert.equal(m.days[0].exercises.length, 2);
  assert.equal(m.log['1-0'].slots.length, 2);
  assert.equal(m.log['2-0'].slots.length, 2);
  assert.equal(m.log['0-0'].slots.length, 2);
});

test('unskipWorkout ("Do it anyway") brings the session up to plan changes made while it was skipped', () => {
  const m = meso();
  C.setPlanSets(m, 0, 0, 2, 4);                                        // while 2-0 was skipped
  C.rebuildOpen(m);
  assert.equal(m.log['2-0'].slots[0].sets.length, 2);                   // skipped: untouched
  const r = C.appendSlot(m, 0, 'z');
  assert.deepEqual(m.log['2-0'].slots[r.i].sets, []);
  C.unskipWorkout(m, 2, 0);
  assert.equal(m.log['2-0'].slots[0].sets.length, 4);
  assert.equal(m.log['2-0'].slots[r.i].sets.length, 2);                 // the appended slot gets its sets
});
