'use strict';
// 3.4: a note per exercise for today (sl.note).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (w, r, done = true) => ({ w: String(w), r: String(r), done });
const blank = () => ({ w: '', r: '', done: false });

test('setNote: trimmed, up to 200 characters, empty removes it; returns the previous note', () => {
  const sl = { sets: [] };
  assert.equal(C.setNote(sl, '  left shoulder twingy  '), '');
  assert.equal(sl.note, 'left shoulder twingy');
  assert.equal(C.setNote(sl, 'x'.repeat(250)), 'left shoulder twingy');
  assert.equal(sl.note.length, 200);
  C.setNote(sl, '   ');
  assert.equal('note' in sl, false);
});

test('lastPerf returns the note of the slot it reports', () => {
  const m = { id: 'm', weeks: 2, deload: false, style: 'fixed', pos: { w: 1, d: 0 }, log: {},
    days: [{ name: 'A', weekday: null, exercises: [{ exId: 'a', plan: [1], reps: [8, 10], type: 'main' }] }] };
  m.log['0-0'] = { date: 5, done: true, slots: [{ exId: 'a', sets: [set(60, 8)], note: 'grip slipped', fb: {} }] };
  assert.equal(C.lastPerf({ exercises: [], mesos: [m] }, 'a').note, 'grip slipped');
});

test('a note is content: hasContent, and plan changes / rest-of-block swaps leave the slot alone', () => {
  const m = { id: 'm', weeks: 3, deload: false, style: 'fixed', pos: { w: 0, d: 0 }, log: {},
    days: [{ name: 'A', weekday: null, exercises: [{ exId: 'a', plan: [2], reps: [8, 10], type: 'main' }] }] };
  m.log['0-0'] = { done: false, slots: [{ exId: 'a', sets: [blank(), blank()], fb: {} }] };
  m.log['1-0'] = { done: false, slots: [{ exId: 'a', sets: [blank(), blank()], note: 'bring straps', fb: {} }] };
  assert.equal(C.hasContent(m.log['1-0']), true);
  assert.equal(C.hasContent({ done: false, slots: [{ sets: [], note: 'x' }] }), true);
  C.setPlanSets(m, 0, 0, 0, 3);
  C.rebuildOpen(m);
  assert.equal(m.log['0-0'].slots[0].sets.length, 3);
  assert.equal(m.log['1-0'].slots[0].sets.length, 2);                  // kept: it has a note
  C.swapBlock(m, 0, 0, 'b', '0-0');
  assert.equal(m.log['1-0'].slots[0].exId, 'a');
  assert.equal(m.log['1-0'].slots[0].note, 'bring straps');
});

test('lastNoteFor: the newest note, also from a workout where the exercise had no counted sets', () => {
  const m = { id: 'm', weeks: 3, deload: false, style: 'fixed', pos: { w: 2, d: 0 }, log: {},
    days: [{ name: 'A', weekday: null, exercises: [{ exId: 'a', plan: [1], reps: [8, 10], type: 'main' }] }] };
  m.log['0-0'] = { date: 5, done: true, slots: [{ exId: 'a', sets: [set(60, 8)], note: 'old', fb: {} }] };
  m.log['1-0'] = { date: 9, done: true, slots: [{ exId: 'a', skip: true, sets: [{ w: '', r: '', done: false, skip: true }], note: 'skipped, shoulder hurt', fb: {} }] };
  const S = { exercises: [], mesos: [m] };
  assert.equal(C.lastPerf(S, 'a').date, 5);                                     // last counted sets
  assert.deepEqual(C.lastNoteFor(S, 'a'), { note: 'skipped, shoulder hurt', date: 9 });
  assert.deepEqual(C.lastNoteFor(S, 'a', { before: 9 }), { note: 'old', date: 5 });
  assert.equal(C.lastNoteFor(S, 'b'), null);
});

test('finish drops empty sets and keeps skipMarked pointing at the right sets; −Set too', () => {
  const m = { id: 'm', weeks: 3, deload: false, style: 'fixed', pos: { w: 0, d: 0 }, log: {},
    days: [{ name: 'A', weekday: null, exercises: [{ exId: 'a', plan: [4], reps: [8, 10], type: 'main' }] }] };
  const s = C.session(m, 0, 0, true);
  const sl = s.slots[0];
  sl.sets = [blank(), set(60, 8), blank(), blank()];
  C.skipSlot(sl);                                                             // marks 0, 2, 3
  C.unskipSet(sl.sets[0]); C.unskipSet(sl.sets[2]);                           // 0 and 2 unskipped by hand: empty again
  C.finishSession(m, 0, 0, s, 1);
  assert.deepEqual(sl.sets.map(x => [x.done, !!x.skip]), [[true, false], [false, true]]);
  assert.deepEqual(sl.skipMarked, [1]);                                       // was 3; 0 and 2 dropped
  C.unskipSlot(sl);
  assert.equal(sl.sets[1].skip, undefined);
  const s2 = { sets: [blank(), blank(), blank()], skipMarked: [2] };
  s2.sets.pop(); C.shiftIdx(s2, 2, -1);
  assert.deepEqual(s2.skipMarked, []);
});
