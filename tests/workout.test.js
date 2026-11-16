'use strict';
// 2.5: skip or discard a whole workout (sequence model: a skipped workout counts as passed).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const set = (w, r, done = true) => ({ w: String(w), r: String(r), done });

function meso() {
  return {
    id: 'm', name: 'B', weeks: 2, deload: false, style: 'fixed', pos: { w: 0, d: 0 }, complete: false, log: {},
    days: [{ name: 'A', weekday: null, exercises: [{ exId: 'a', plan: [2], reps: [8, 10], type: 'main' }] },
      { name: 'B', weekday: null, exercises: [{ exId: 'b', plan: [2], reps: [8, 10], type: 'main' }] }],
  };
}

test('skipWorkout: creates a full session, marks it, moves on; Undo restores session and position', () => {
  const m = meso();
  const r = C.skipWorkout(m, 0, 0, 500);
  const s = m.log['0-0'];
  assert.equal(s.skipped, true);
  assert.equal(s.skippedAt, 500);
  assert.equal(s.done, false);
  assert.equal(s.slots.length, 1);
  assert.equal(s.slots[0].sets.length, 2);                     // full blank slots
  assert.deepEqual(m.pos, { w: 0, d: 1 });
  C.restoreSkip(m, 0, 0, r.snap);
  assert.equal(m.log['0-0'], undefined);                       // the skip created it: gone again
  assert.deepEqual(m.pos, { w: 0, d: 0 });
});

test('skipWorkout keeps typed/skipped content; refused once a set is done; Undo restores in place', () => {
  const m = meso();
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets[0] = { w: '60', r: '', done: false };
  const before = JSON.parse(JSON.stringify(s));
  const r = C.skipWorkout(m, 0, 0, 1);
  assert.equal(s.slots[0].sets[0].w, '60');
  C.restoreSkip(m, 0, 0, r.snap);
  assert.deepEqual(m.log['0-0'], before);
  assert.equal(m.log['0-0'], s);
  s.slots[0].sets[0] = set(60, 8);
  assert.deepEqual(C.skipWorkout(m, 0, 0, 1), { error: 'done' });
  assert.equal(s.skipped, undefined);
});

test('advance treats skipped as passed; all skipped/done → complete; canWrite refuses a skipped session', () => {
  const m = meso();
  C.skipWorkout(m, 0, 0, 1);
  m.log['0-1'] = { date: 2, done: true, slots: [] };
  C.advance(m);
  assert.deepEqual(m.pos, { w: 1, d: 0 });
  C.skipWorkout(m, 1, 0, 3);
  C.skipWorkout(m, 1, 1, 4);
  assert.equal(m.complete, true);
  assert.equal(C.canWrite(m.log['0-0'], 'k', 'k'), false);    // not even with Edit on
  assert.equal(C.canWrite(m.log['0-1'], 'k', 'k'), true);
  assert.equal(C.hasLogs(m), true);                            // a skip record blocks the wholesale plan editor
  assert.equal(C.hasContent(m.log['1-1']), true);
});

test('unskipWorkout ("Do it anyway"): an old skipped workout becomes next up again', () => {
  const m = meso();
  C.skipWorkout(m, 0, 0, 1);
  m.log['0-1'] = { date: 2, done: true, slots: [] };
  C.advance(m);
  assert.deepEqual(m.pos, { w: 1, d: 0 });
  assert.deepEqual(C.unskipWorkout(m, 0, 0), { moved: true });
  assert.deepEqual(m.pos, { w: 0, d: 0 });
  assert.equal('skipped' in m.log['0-0'] || 'skippedAt' in m.log['0-0'], false);
  assert.deepEqual(C.unskipWorkout(m, 0, 0), { moved: false });
});

test('skipped sessions are left out of history and stats', () => {
  const m = meso();
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets[0] = { w: '60', r: '8', done: false };       // typed, never ticked
  C.skipWorkout(m, 0, 0, 1);
  const S = { exercises: [{ id: 'a', name: 'A', muscle: 'Chest' }], mesos: [m] };
  assert.deepEqual(C.allSessions(S), []);
  assert.deepEqual(C.perfFor(S, 'a'), []);
  assert.equal(C.lastPerf(S, 'a'), null);
});

test('discardWorkout: deletes an unfinished session without moving on; never a finished or skipped one', () => {
  const m = meso();
  const s = C.session(m, 0, 0, true);
  s.slots[0].sets = [set(60, 8), { w: '60', r: '', done: false }, { w: '', r: '', done: false }];
  assert.equal(C.loggedSets(s), 2);
  const r = C.discardWorkout(m, 0, 0);
  assert.equal(r.s, s);
  assert.equal(m.log['0-0'], undefined);
  assert.deepEqual(m.pos, { w: 0, d: 0 });
  m.log['0-0'] = r.s;                                           // Undo
  s.done = true;
  assert.deepEqual(C.discardWorkout(m, 0, 0), { error: 'state' });
  assert.deepEqual(C.discardWorkout(m, 1, 1), { error: 'missing' });
  C.skipWorkout(m, 0, 1, 1);
  assert.deepEqual(C.discardWorkout(m, 0, 1), { error: 'state' });
});
