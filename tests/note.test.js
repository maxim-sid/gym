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
